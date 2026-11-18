import React, { useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  RefreshControl,
  Linking,
} from "react-native";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  setDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { signOut, User } from "firebase/auth";
import { db, auth } from "../firebase";
import { formatDate, formatDateTime, getTimestampMs } from "../utils/dateUtils";

interface StudentPortalProps {
  user: User;
  profile: any;
  onLogout?: () => Promise<void>;
}

type TabType =
  | "dashboard"
  | "attendance"
  | "assignments"
  | "materials"
  | "announcements"
  | "events"
  | "notifications"
  | "timetable"
  | "complaints"
  | "profile";

export default function StudentPortal({ user, profile, onLogout }: StudentPortalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("dashboard");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Data states
  const [attendance, setAttendance] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, any>>({});
  const [materials, setMaterials] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [registeredEvents, setRegisteredEvents] = useState<string[]>([]);
  const [timetable, setTimetable] = useState<any[]>([]);
  const [complaints, setComplaints] = useState<any[]>([]);

  // Submission inputs
  const [answerTexts, setAnswerTexts] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState("");
  const [submissionMsg, setSubmissionMsg] = useState("");

  // Complaint inputs
  const [complaintSubject, setComplaintSubject] = useState("");
  const [complaintDesc, setComplaintDesc] = useState("");
  const [submittingComplaint, setSubmittingComplaint] = useState(false);
  const [complaintMsg, setComplaintMsg] = useState("");

  const studentCourse = profile?.courseId || "MCA";
  const studentSemester = profile?.semester ? Number(profile.semester) : 3;

  const loadData = async () => {
    try {
      setLoading(true);

      // 1. Attendance Records
      const attSnap = await getDocs(
        query(collection(db, "attendanceRecords"), where("studentId", "==", user.uid))
      );
      setAttendance(attSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // 2. Course Assignments
      const asgSnap = await getDocs(
        query(
          collection(db, "assignments"),
          where("courseId", "==", studentCourse),
          where("semester", "==", studentSemester),
          where("status", "==", "active")
        )
      );
      setAssignments(asgSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // 3. Submissions
      const subSnap = await getDocs(
        query(collection(db, "submissions"), where("studentId", "==", user.uid))
      );
      const subMap: Record<string, any> = {};
      subSnap.docs.forEach((d) => {
        const item = d.data();
        if (item.assignmentId) subMap[item.assignmentId] = item;
      });
      setSubmissions(subMap);

      // 4. Study Materials
      const matSnap = await getDocs(
        query(
          collection(db, "studyMaterials"),
          where("courseId", "==", studentCourse),
          where("semester", "==", studentSemester)
        )
      );
      setMaterials(matSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // 5. Announcements
      const annSnap = await getDocs(collection(db, "announcements"));
      setAnnouncements(annSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // 6. Events
      const evtSnap = await getDocs(collection(db, "events"));
      setEvents(evtSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // 7. Event registrations
      const regSnap = await getDocs(
        query(collection(db, "eventRegistrations"), where("studentId", "==", user.uid))
      );
      setRegisteredEvents(regSnap.docs.map((d) => d.data().eventId));

      // 8. Timetable
      try {
        const ttSnap = await getDocs(
          query(collection(db, "timetables"), where("courseId", "==", studentCourse))
        );
        setTimetable(ttSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (ttErr) {
        console.warn("Timetable load non-fatal error:", ttErr);
      }

      // 9. Complaints
      try {
        const compSnap = await getDocs(
          query(collection(db, "complaints"), where("studentId", "==", user.uid))
        );
        setComplaints(compSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (compErr) {
        console.warn("Complaints load non-fatal error:", compErr);
      }
    } catch (err) {
      console.error("Student portal load error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user.uid, studentCourse, studentSemester]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleLogout = async () => {
    try {
      if (onLogout) await onLogout();
      else await signOut(auth);
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  // Metrics
  const presentCount = attendance.filter(
    (a) => a.status?.toLowerCase() === "present"
  ).length;
  const totalClasses = attendance.length;
  const attendanceRate = totalClasses ? Math.round((presentCount / totalClasses) * 100) : 0;
  const pendingAssignments = assignments.filter((a) => !submissions[a.id]);

  // Submit assignment
  const handleSubmitAssignment = async (assignment: any) => {
    const text = answerTexts[assignment.id]?.trim();
    if (!text) {
      setSubmissionMsg("Please enter an answer before submitting.");
      return;
    }

    try {
      setSubmittingId(assignment.id);
      setSubmissionMsg("");
      const submissionId = `${assignment.id}_${user.uid}`;
      const subData = {
        assignmentId: assignment.id,
        studentId: user.uid,
        subjectId: assignment.subjectId || "",
        submissionText: text,
        fileUrl: "",
        marks: 0,
        status: "submitted",
        feedback: "Pending evaluation",
        submittedAt: serverTimestamp(),
      };

      await setDoc(doc(db, "submissions", submissionId), subData);
      setSubmissions((prev) => ({ ...prev, [assignment.id]: subData }));
      setSubmissionMsg("Assignment submitted successfully!");
    } catch (err: any) {
      setSubmissionMsg(err.message || "Failed to submit assignment.");
    } finally {
      setSubmittingId("");
    }
  };

  // Register for event
  const handleRegisterEvent = async (event: any) => {
    try {
      const regId = `${event.id}_${user.uid}`;
      await setDoc(doc(db, "eventRegistrations", regId), {
        eventId: event.id,
        studentId: user.uid,
        status: "registered",
        registeredAt: serverTimestamp(),
      });
      setRegisteredEvents((prev) => [...prev, event.id]);
    } catch (err) {
      console.error("Event registration error:", err);
    }
  };

  // Submit student complaint / ticket
  const handleSubmitComplaint = async () => {
    if (!complaintSubject.trim() || !complaintDesc.trim()) {
      setComplaintMsg("Please enter both a subject and details for your complaint.");
      return;
    }

    try {
      setSubmittingComplaint(true);
      setComplaintMsg("");
      await addDoc(collection(db, "complaints"), {
        studentId: user.uid,
        studentName: profile?.fullName || "Student",
        courseId: studentCourse,
        semester: studentSemester,
        subject: complaintSubject.trim(),
        description: complaintDesc.trim(),
        status: "open",
        createdAt: serverTimestamp(),
      });
      setComplaintSubject("");
      setComplaintDesc("");
      setComplaintMsg("✓ Your complaint has been submitted to campus administration.");
      // Refresh complaints list
      const compSnap = await getDocs(
        query(collection(db, "complaints"), where("studentId", "==", user.uid))
      );
      setComplaints(compSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err: any) {
      console.error("Complaint submission error:", err);
      setComplaintMsg(err.message || "Failed to submit complaint.");
    } finally {
      setSubmittingComplaint(false);
    }
  };

  const relevantAnnouncements = useMemo(() => {
    return announcements.filter((a) => {
      const matchCourse =
        !a.courseId ||
        a.courseId === "All" ||
        a.courseId.toLowerCase() === studentCourse.toLowerCase();
      const matchSem =
        !a.semester ||
        String(a.semester) === "All" ||
        Number(a.semester) === studentSemester;
      return matchCourse && matchSem;
    });
  }, [announcements, studentCourse, studentSemester]);

  // Render Sub-Views
  const renderContent = () => {
    if (loading && !refreshing) {
      return (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.loadingText}>Loading campus updates...</Text>
        </View>
      );
    }

    switch (activeTab) {
      case "dashboard":
        return (
          <View>
            {/* Banner */}
            <View style={styles.banner}>
              <Text style={styles.bannerGreeting}>
                Hello, {profile?.fullName || "Student"}! 🎓
              </Text>
              <Text style={styles.bannerSub}>
                {studentCourse} Semester {studentSemester} • Sec {profile?.section || "A"}
              </Text>
            </View>

            {/* KPI Cards */}
            <View style={styles.statsRow}>
              <View style={[styles.statBox, { borderLeftColor: "#10b981" }]}>
                <Text style={styles.statEmoji}>📊</Text>
                <Text style={styles.statLabel}>Attendance</Text>
                <Text style={styles.statValue}>{attendanceRate}%</Text>
                <Text style={styles.statSub}>{presentCount} / {totalClasses} classes</Text>
              </View>

              <View style={[styles.statBox, { borderLeftColor: "#3b82f6" }]}>
                <Text style={styles.statEmoji}>📝</Text>
                <Text style={styles.statLabel}>Pending Work</Text>
                <Text style={styles.statValue}>{pendingAssignments.length}</Text>
                <Text style={styles.statSub}>Due assignments</Text>
              </View>
            </View>

            <View style={styles.statsRow}>
              <View style={[styles.statBox, { borderLeftColor: "#8b5cf6" }]}>
                <Text style={styles.statEmoji}>📚</Text>
                <Text style={styles.statLabel}>Study Materials</Text>
                <Text style={styles.statValue}>{materials.length}</Text>
                <Text style={styles.statSub}>Notes uploaded</Text>
              </View>

              <View style={[styles.statBox, { borderLeftColor: "#f59e0b" }]}>
                <Text style={styles.statEmoji}>📢</Text>
                <Text style={styles.statLabel}>Notices</Text>
                <Text style={styles.statValue}>{relevantAnnouncements.length}</Text>
                <Text style={styles.statSub}>Campus updates</Text>
              </View>
            </View>

            {/* Quick Actions */}
            <Text style={styles.sectionTitle}>⚡ Quick Services</Text>
            <View style={styles.quickGrid}>
              <TouchableOpacity
                style={styles.quickCard}
                onPress={() => setActiveTab("attendance")}
              >
                <Text style={styles.quickEmoji}>📊</Text>
                <Text style={styles.quickText}>Attendance</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickCard}
                onPress={() => setActiveTab("assignments")}
              >
                <Text style={styles.quickEmoji}>📝</Text>
                <Text style={styles.quickText}>Assignments</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickCard}
                onPress={() => setActiveTab("materials")}
              >
                <Text style={styles.quickEmoji}>📚</Text>
                <Text style={styles.quickText}>Notes</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickCard}
                onPress={() => setActiveTab("events")}
              >
                <Text style={styles.quickEmoji}>🎉</Text>
                <Text style={styles.quickText}>Events</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickCard}
                onPress={() => setActiveTab("timetable")}
              >
                <Text style={styles.quickEmoji}>📅</Text>
                <Text style={styles.quickText}>Timetable</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickCard}
                onPress={() => setActiveTab("complaints")}
              >
                <Text style={styles.quickEmoji}>💬</Text>
                <Text style={styles.quickText}>Helpdesk</Text>
              </TouchableOpacity>
            </View>
          </View>
        );

      case "attendance":
        return (
          <View>
            <Text style={styles.pageTitle}>📊 My Attendance Summary</Text>
            <View style={styles.attOverview}>
              <Text style={styles.attBigRate}>{attendanceRate}%</Text>
              <Text style={styles.attSubText}>
                {attendanceRate >= 75 ? "✅ Eligible for Semester Exams" : "⚠️ Low Attendance (< 75%)"}
              </Text>
              <Text style={styles.attDetailText}>
                Present: {presentCount} • Absent: {totalClasses - presentCount} • Total: {totalClasses}
              </Text>
            </View>

            <Text style={styles.sectionTitle}>Session History ({attendance.length})</Text>
            {attendance.length === 0 ? (
              <Text style={styles.emptyText}>No attendance records recorded yet.</Text>
            ) : (
              attendance
                .slice()
                .sort((a, b) => getTimestampMs(b.date || b.createdAt) - getTimestampMs(a.date || a.createdAt))
                .map((item) => (
                  <View key={item.id} style={styles.listItem}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.listBold}>{item.subjectId || "Subject"}</Text>
                      <Text style={styles.listSub}>Date: {formatDate(item.date || item.createdAt)}</Text>
                    </View>
                    <View
                      style={[
                        styles.badge,
                        item.status?.toLowerCase() === "present"
                          ? styles.badgeSuccess
                          : styles.badgeDanger,
                      ]}
                    >
                      <Text
                        style={[
                          styles.badgeText,
                          item.status?.toLowerCase() === "present"
                            ? styles.badgeTextSuccess
                            : styles.badgeTextDanger,
                        ]}
                      >
                        {item.status || "Unknown"}
                      </Text>
                    </View>
                  </View>
                ))
            )}
          </View>
        );

      case "assignments":
        return (
          <View>
            <Text style={styles.pageTitle}>📝 Course Assignments</Text>
            {submissionMsg ? (
              <View style={styles.alertBox}>
                <Text style={styles.alertText}>{submissionMsg}</Text>
              </View>
            ) : null}

            {assignments.length === 0 ? (
              <Text style={styles.emptyText}>No assignments posted for your course.</Text>
            ) : (
              assignments.map((item) => {
                const sub = submissions[item.id];
                const isSubmitting = submittingId === item.id;

                return (
                  <View key={item.id} style={styles.cardItem}>
                    <View style={styles.cardHeader}>
                      <Text style={styles.cardBold}>{item.title}</Text>
                      <View
                        style={[
                          styles.badge,
                          sub ? (sub.status === "evaluated" ? styles.badgeSuccess : styles.badgeInfo) : styles.badgeWarning,
                        ]}
                      >
                        <Text style={styles.badgeText}>
                          {sub ? (sub.status === "evaluated" ? `Graded: ${sub.marks}/100` : "Submitted") : "Pending"}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.listSub}>
                      Subject: {item.subjectId} • Due: {formatDate(item.dueDate, "No deadline")}
                      {item.createdAt ? ` • Posted: ${formatDate(item.createdAt)}` : ""}
                    </Text>
                    <Text style={styles.cardBody}>{item.description}</Text>

                    {sub ? (
                      <View style={styles.subResultBox}>
                        <Text style={styles.subLabel}>
                          ✓ Your Answer Submitted ({formatDate(sub.submittedAt || sub.createdAt, "Submitted")}):
                        </Text>
                        <Text style={styles.subText}>{sub.submissionText}</Text>
                        {sub.status === "evaluated" && (
                          <View style={{ marginTop: 6 }}>
                            <Text style={{ fontWeight: "bold", color: "#166534", fontSize: 13 }}>
                              Marks: {sub.marks} / 100
                            </Text>
                            <Text style={{ fontSize: 12, color: "#334155" }}>
                              Feedback: {sub.feedback || "Good work."}
                            </Text>
                            {sub.evaluatedAt ? (
                              <Text style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                                Graded: {formatDate(sub.evaluatedAt)}
                              </Text>
                            ) : null}
                          </View>
                        )}
                      </View>
                    ) : (
                      <View style={{ marginTop: 10 }}>
                        <TextInput
                          style={styles.textArea}
                          placeholder="Type your response / answer..."
                          placeholderTextColor="#94a3b8"
                          multiline
                          numberOfLines={3}
                          value={answerTexts[item.id] || ""}
                          onChangeText={(txt) =>
                            setAnswerTexts((prev) => ({ ...prev, [item.id]: txt }))
                          }
                        />
                        <TouchableOpacity
                          style={styles.actionBtn}
                          onPress={() => handleSubmitAssignment(item)}
                          disabled={isSubmitting}
                        >
                          {isSubmitting ? (
                            <ActivityIndicator color="#ffffff" size="small" />
                          ) : (
                            <Text style={styles.actionBtnText}>Submit Answer</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </View>
        );

      case "materials":
        return (
          <View>
            <Text style={styles.pageTitle}>📚 Learning Materials & Notes</Text>
            {materials.length === 0 ? (
              <Text style={styles.emptyText}>No study materials uploaded for your semester.</Text>
            ) : (
              materials.map((m) => (
                <View key={m.id} style={styles.cardItem}>
                  <Text style={styles.cardBold}>{m.title}</Text>
                  <Text style={styles.listSub}>
                    Subject: {m.subjectId}
                    {m.uploadedAt || m.createdAt ? ` • ${formatDate(m.uploadedAt || m.createdAt)}` : ""}
                  </Text>
                  <Text style={styles.cardBody}>{m.description}</Text>
                  {m.fileUrl ? (
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: "#1e40af", marginTop: 8 }]}
                      onPress={() => Linking.openURL(m.fileUrl)}
                    >
                      <Text style={styles.actionBtnText}>📥 Open Resource ↗</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))
            )}
          </View>
        );

      case "announcements":
        return (
          <View>
            <Text style={styles.pageTitle}>📢 Campus Notices</Text>
            {relevantAnnouncements.length === 0 ? (
              <Text style={styles.emptyText}>No announcements available.</Text>
            ) : (
              relevantAnnouncements.map((a) => (
                <View key={a.id} style={styles.cardItem}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardBold}>{a.title}</Text>
                    {a.priority && (
                      <View style={[styles.badge, a.priority === "urgent" ? styles.badgeDanger : styles.badgeInfo]}>
                        <Text style={styles.badgeText}>{a.priority}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.listSub}>
                    By {a.authorName || "Faculty"} • {a.courseId || "All"}
                    {a.createdAt || a.date ? ` • ${formatDate(a.createdAt || a.date)}` : ""}
                  </Text>
                  <Text style={styles.cardBody}>{a.description || a.message}</Text>
                </View>
              ))
            )}
          </View>
        );

      case "events":
        return (
          <View>
            <Text style={styles.pageTitle}>🎉 Campus Events</Text>
            {events.length === 0 ? (
              <Text style={styles.emptyText}>No events scheduled currently.</Text>
            ) : (
              events.map((e) => {
                const isReg = registeredEvents.includes(e.id);
                return (
                  <View key={e.id} style={styles.cardItem}>
                    <Text style={styles.cardBold}>{e.title}</Text>
                    <Text style={styles.listSub}>
                      📅 {formatDate(e.date || e.eventDate || e.createdAt, "Date TBA")} • 📍 {e.venue || "Campus Venue"}
                    </Text>
                    <Text style={styles.cardBody}>{e.description}</Text>
                    <TouchableOpacity
                      style={[styles.actionBtn, isReg && { backgroundColor: "#16a34a" }]}
                      onPress={() => handleRegisterEvent(e)}
                      disabled={isReg}
                    >
                      <Text style={styles.actionBtnText}>
                        {isReg ? "✓ Registered" : "Register for Event"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
          </View>
        );

      case "notifications":
        return (
          <View>
            <Text style={styles.pageTitle}>🔔 Notifications Center</Text>
            {relevantAnnouncements.length === 0 ? (
              <Text style={styles.emptyText}>No new notifications.</Text>
            ) : (
              relevantAnnouncements.map((a) => (
                <View key={a.id} style={styles.listItem}>
                  <Text style={{ fontSize: 20, marginRight: 10 }}>🔔</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listBold}>{a.title}</Text>
                    <Text style={styles.cardBody} numberOfLines={2}>
                      {a.description || a.message}
                    </Text>
                    {a.createdAt || a.date ? (
                      <Text style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                        {formatDateTime(a.createdAt || a.date)}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))
            )}
          </View>
        );

      case "timetable":
        return (
          <View>
            <Text style={styles.pageTitle}>📅 Weekly Class Timetable</Text>
            <Text style={styles.listSub}>
              Schedule for {studentCourse} Semester {studentSemester}
            </Text>
            {timetable.length === 0 ? (
              <Text style={styles.emptyText}>No timetable entries published for your course.</Text>
            ) : (
              timetable.map((tt) => (
                <View key={tt.id} style={styles.cardItem}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardBold}>{tt.subjectName || tt.subjectId || "Class"}</Text>
                    <View style={[styles.badge, styles.badgeInfo]}>
                      <Text style={styles.badgeText}>{tt.day || "Scheduled"}</Text>
                    </View>
                  </View>
                  <Text style={styles.listSub}>
                    ⏰ {tt.time || tt.slot || "Regular Hour"} • 📍 Room {tt.room || tt.classroom || "TBA"}
                  </Text>
                  {tt.facultyName && (
                    <Text style={styles.cardBody}>Faculty: {tt.facultyName}</Text>
                  )}
                </View>
              ))
            )}
          </View>
        );

      case "complaints":
        return (
          <View>
            <Text style={styles.pageTitle}>💬 Student Helpdesk & Complaints</Text>
            {complaintMsg ? (
              <View style={styles.alertBox}>
                <Text style={styles.alertText}>{complaintMsg}</Text>
              </View>
            ) : null}

            {/* New Complaint Form */}
            <View style={styles.cardItem}>
              <Text style={styles.inputLabel}>Subject / Issue Category</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Lab Access / Library Books / Fee Receipt"
                placeholderTextColor="#94a3b8"
                value={complaintSubject}
                onChangeText={setComplaintSubject}
              />

              <Text style={styles.inputLabel}>Complaint Details</Text>
              <TextInput
                style={[styles.input, { height: 80 }]}
                placeholder="Describe your issue or request clearly..."
                placeholderTextColor="#94a3b8"
                multiline
                value={complaintDesc}
                onChangeText={setComplaintDesc}
              />

              <TouchableOpacity
                style={[styles.actionBtn, submittingComplaint && { backgroundColor: "#93c5fd" }]}
                onPress={handleSubmitComplaint}
                disabled={submittingComplaint}
              >
                {submittingComplaint ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.actionBtnText}>Submit Complaint Ticket</Text>
                )}
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>My Past Complaints ({complaints.length})</Text>
            {complaints.length === 0 ? (
              <Text style={styles.emptyText}>You haven't submitted any complaints.</Text>
            ) : (
              complaints.map((c) => (
                <View key={c.id} style={styles.cardItem}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardBold}>{c.subject}</Text>
                    <View
                      style={[
                        styles.badge,
                        c.status === "resolved"
                          ? styles.badgeSuccess
                          : c.status === "in_progress"
                          ? styles.badgeInfo
                          : styles.badgeWarning,
                      ]}
                    >
                      <Text style={styles.badgeText}>
                        {c.status ? c.status.replace("_", " ").toUpperCase() : "OPEN"}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.listSub}>
                    Submitted: {formatDate(c.createdAt)}
                  </Text>
                  <Text style={styles.cardBody}>{c.description}</Text>
                  {c.adminResponse && (
                    <View style={{ backgroundColor: "#f0fdf4", padding: 8, borderRadius: 6, marginTop: 6 }}>
                      <Text style={{ fontWeight: "600", color: "#166534", fontSize: 12 }}>
                        Admin Resolution:
                      </Text>
                      <Text style={{ color: "#1e293b", fontSize: 12, marginTop: 2 }}>
                        {c.adminResponse}
                      </Text>
                    </View>
                  )}
                </View>
              ))
            )}
          </View>
        );

      case "profile":
        return (
          <View style={styles.profileCard}>
            <View style={styles.profileAvatar}>
              <Text style={styles.avatarLetter}>
                {(profile?.fullName || "S").charAt(0).toUpperCase()}
              </Text>
            </View>

            <Text style={styles.profileName}>{profile?.fullName || "Student Name"}</Text>
            <Text style={styles.profileEmail}>{profile?.email || user.email}</Text>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Course Program:</Text>
              <Text style={styles.detailValue}>{studentCourse}</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Semester & Section:</Text>
              <Text style={styles.detailValue}>
                Semester {studentSemester} • Section {profile?.section || "A"}
              </Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Student UID:</Text>
              <Text style={[styles.detailValue, { fontSize: 11 }]}>{user.uid}</Text>
            </View>

            <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
              <Text style={styles.logoutBtnText}>↪ Sign Out of Mobile App</Text>
            </TouchableOpacity>
          </View>
        );
    }
  };

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerBrand}>CampusConnect 360</Text>
          <Text style={styles.headerSub}>Student Mobile Portal</Text>
        </View>
        <TouchableOpacity style={styles.headerProfileBtn} onPress={() => setActiveTab("profile")}>
          <Text style={styles.headerProfileLetter}>
            {(profile?.fullName || "S").charAt(0).toUpperCase()}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Main Content */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {renderContent()}
      </ScrollView>

      {/* Bottom Navigation Bar */}
      <View style={styles.bottomNav}>
        {[
          { tab: "dashboard", label: "Home", icon: "🏠" },
          { tab: "attendance", label: "Attendance", icon: "📊" },
          { tab: "assignments", label: "Tasks", icon: "📝" },
          { tab: "announcements", label: "Notices", icon: "📢" },
          { tab: "profile", label: "Profile", icon: "👤" },
        ].map((item) => (
          <TouchableOpacity
            key={item.tab}
            style={[styles.navBtn, activeTab === item.tab && styles.navBtnActive]}
            onPress={() => setActiveTab(item.tab as TabType)}
          >
            <Text style={styles.navIcon}>{item.icon}</Text>
            <Text style={[styles.navLabel, activeTab === item.tab && styles.navLabelActive]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f7fc",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#1e3a8a",
    paddingTop: 45,
    paddingBottom: 15,
    paddingHorizontal: 18,
  },
  headerLeft: {
    flex: 1,
  },
  headerBrand: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#ffffff",
  },
  headerSub: {
    fontSize: 12,
    color: "#93c5fd",
  },
  headerProfileBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#3b82f6",
    justifyContent: "center",
    alignItems: "center",
  },
  headerProfileLetter: {
    color: "#ffffff",
    fontWeight: "bold",
    fontSize: 16,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 80,
  },
  centerBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 50,
  },
  loadingText: {
    color: "#64748b",
    fontSize: 14,
    marginTop: 10,
  },
  banner: {
    backgroundColor: "#2563eb",
    borderRadius: 14,
    padding: 18,
    marginBottom: 16,
  },
  bannerGreeting: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 4,
  },
  bannerSub: {
    color: "#dbeafe",
    fontSize: 13,
  },
  statsRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  statBox: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 10,
    padding: 14,
    borderLeftWidth: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  statEmoji: {
    fontSize: 20,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: "#64748b",
    fontWeight: "600",
  },
  statValue: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#0f172a",
    marginVertical: 2,
  },
  statSub: {
    fontSize: 11,
    color: "#94a3b8",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#1e293b",
    marginVertical: 14,
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#0f172a",
    marginBottom: 14,
  },
  quickGrid: {
    flexDirection: "row",
    gap: 10,
  },
  quickCard: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  quickEmoji: {
    fontSize: 22,
    marginBottom: 4,
  },
  quickText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#334155",
  },
  attOverview: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 20,
    alignItems: "center",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  attBigRate: {
    fontSize: 44,
    fontWeight: "bold",
    color: "#2563eb",
  },
  attSubText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#16a34a",
    marginVertical: 4,
  },
  attDetailText: {
    fontSize: 12,
    color: "#64748b",
  },
  listItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  listBold: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1e293b",
  },
  listSub: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 2,
  },
  cardItem: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  cardBold: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#0f172a",
    flex: 1,
  },
  cardBody: {
    fontSize: 13,
    color: "#334155",
    lineHeight: 18,
    marginTop: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: "#e2e8f0",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#334155",
  },
  badgeSuccess: {
    backgroundColor: "#dcfce7",
  },
  badgeTextSuccess: {
    color: "#15803d",
  },
  badgeDanger: {
    backgroundColor: "#fee2e2",
  },
  badgeTextDanger: {
    color: "#b91c1c",
  },
  badgeWarning: {
    backgroundColor: "#fef3c7",
  },
  badgeInfo: {
    backgroundColor: "#dbeafe",
  },
  emptyText: {
    textAlign: "center",
    color: "#94a3b8",
    paddingVertical: 30,
    fontSize: 14,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#334155",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: "#0f172a",
    backgroundColor: "#f8fafc",
    marginBottom: 10,
  },
  textArea: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    color: "#0f172a",
    backgroundColor: "#f8fafc",
    marginBottom: 8,
  },
  actionBtn: {
    backgroundColor: "#2563eb",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  actionBtnText: {
    color: "#ffffff",
    fontWeight: "bold",
    fontSize: 13,
  },
  subResultBox: {
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  subLabel: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#16a34a",
  },
  subText: {
    fontSize: 13,
    color: "#1e293b",
    marginTop: 4,
  },
  alertBox: {
    backgroundColor: "#eff6ff",
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  alertText: {
    color: "#1d4ed8",
    fontSize: 13,
  },
  profileCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  profileAvatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: "#2563eb",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  avatarLetter: {
    color: "#ffffff",
    fontSize: 32,
    fontWeight: "bold",
  },
  profileName: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#0f172a",
  },
  profileEmail: {
    fontSize: 13,
    color: "#64748b",
    marginBottom: 18,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  detailLabel: {
    fontSize: 13,
    color: "#64748b",
  },
  detailValue: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#1e293b",
  },
  logoutBtn: {
    marginTop: 24,
    backgroundColor: "#fee2e2",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    width: "100%",
    alignItems: "center",
  },
  logoutBtnText: {
    color: "#dc2626",
    fontWeight: "bold",
    fontSize: 14,
  },
  bottomNav: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#ffffff",
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingVertical: 8,
  },
  navBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 4,
  },
  navBtnActive: {},
  navIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  navLabel: {
    fontSize: 10,
    color: "#64748b",
    fontWeight: "500",
  },
  navLabelActive: {
    color: "#2563eb",
    fontWeight: "bold",
  },
});
