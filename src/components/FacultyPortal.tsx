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
} from "react-native";
import {
  collection,
  getDocs,
  query,
  where,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { signOut, User } from "firebase/auth";
import { db, auth } from "../firebase";
import { formatDate, formatDateTime, getTimestampMs } from "../utils/dateUtils";

interface FacultyPortalProps {
  user: User;
  profile: any;
  onLogout?: () => Promise<void>;
}

type FacultyTab =
  | "dashboard"
  | "subjects"
  | "attendance"
  | "assignments"
  | "submissions"
  | "materials"
  | "announcements"
  | "profile";

export default function FacultyPortal({ user, profile, onLogout }: FacultyPortalProps) {
  const [activeTab, setActiveTab] = useState<FacultyTab>("dashboard");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Data states
  const [assignedSubjects, setAssignedSubjects] = useState<any[]>([]);
  const [enrolledStudents, setEnrolledStudents] = useState<any[]>([]);
  const [attendanceSessions, setAttendanceSessions] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);

  // Form states
  const [actionMsg, setActionMsg] = useState("");
  const [savingAction, setSavingAction] = useState(false);

  // Mark Attendance Form State
  const [attSubject, setAttSubject] = useState("");
  const [attDate, setAttDate] = useState(new Date().toISOString().split("T")[0]);
  const [studentAttendanceMap, setStudentAttendanceMap] = useState<Record<string, boolean>>({});

  // New Assignment Form State
  const [asgTitle, setAsgTitle] = useState("");
  const [asgDesc, setAsgDesc] = useState("");
  const [asgSubject, setAsgSubject] = useState("");
  const [asgDueDate, setAsgDueDate] = useState("");

  // New Study Material Form State
  const [matTitle, setMatTitle] = useState("");
  const [matDesc, setMatDesc] = useState("");
  const [matSubject, setMatSubject] = useState("");
  const [matUrl, setMatUrl] = useState("");

  // New Announcement Form State
  const [annTitle, setAnnTitle] = useState("");
  const [annDesc, setAnnDesc] = useState("");
  const [annPriority, setAnnPriority] = useState("normal");
  const [annSection, setAnnSection] = useState("All");

  // Evaluation modal/input state
  const [evalMarks, setEvalMarks] = useState<Record<string, string>>({});
  const [evalFeedback, setEvalFeedback] = useState<Record<string, string>>({});

  const loadData = async () => {
    try {
      setLoading(true);

      // 1. Faculty Subjects
      const subjSnap = await getDocs(
        query(
          collection(db, "facultyAssignments"),
          where("facultyId", "==", user.uid),
          where("status", "==", "active")
        )
      );
      const subjs: any[] = subjSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setAssignedSubjects(subjs);
      if (subjs.length > 0) {
        setAttSubject(subjs[0].subjectId);
        setAsgSubject(subjs[0].subjectId);
        setMatSubject(subjs[0].subjectId);
      }

      // 2. Enrolled Students
      const enrollSnap = await getDocs(
        query(collection(db, "enrollments"), where("facultyId", "==", user.uid))
      );
      setEnrolledStudents(enrollSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // 3. Attendance Sessions
      const attSnap = await getDocs(
        query(collection(db, "attendanceSessions"), where("facultyId", "==", user.uid))
      );
      setAttendanceSessions(attSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // 4. Assignments
      const asgSnap = await getDocs(
        query(collection(db, "assignments"), where("facultyId", "==", user.uid))
      );
      const asgList: any[] = asgSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setAssignments(asgList);

      // 5. Submissions for this faculty's assignments
      const subSnap = await getDocs(collection(db, "submissions"));
      const asgIds = new Set(asgList.map((a: any) => a.id));
      const mySubs = subSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as any))
        .filter((s: any) => asgIds.has(s.assignmentId));
      setSubmissions(mySubs);

      // 6. Study Materials
      const matSnap = await getDocs(
        query(collection(db, "studyMaterials"), where("facultyId", "==", user.uid))
      );
      setMaterials(matSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // 7. Announcements
      const annSnap = await getDocs(
        query(collection(db, "announcements"), where("createdBy", "==", user.uid))
      );
      setAnnouncements(annSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error("Faculty data load error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user.uid]);

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

  // Distinct enrolled students count
  const uniqueStudents = useMemo(() => {
    const set = new Set();
    enrolledStudents.forEach((e) => {
      if (e.studentId) set.add(e.studentId);
    });
    return set.size;
  }, [enrolledStudents]);

  // Students enrolled in selected attendance subject
  const currentSubjectStudents = useMemo(() => {
    if (!attSubject) return enrolledStudents;
    return enrolledStudents.filter((e) => e.subjectId === attSubject);
  }, [enrolledStudents, attSubject]);

  // Toggle student present/absent
  const toggleAttendance = (studentId: string) => {
    setStudentAttendanceMap((prev) => ({
      ...prev,
      [studentId]: !prev[studentId],
    }));
  };

  // Submit Mark Attendance
  const handleSaveAttendance = async () => {
    if (!attSubject || currentSubjectStudents.length === 0) {
      setActionMsg("No students enrolled for the selected subject.");
      return;
    }

    try {
      setSavingAction(true);
      setActionMsg("");

      const selectedSubObj = assignedSubjects.find((s) => s.subjectId === attSubject);
      let presentCount = 0;
      let absentCount = 0;

      // Create session document
      const sessionDoc = await addDoc(collection(db, "attendanceSessions"), {
        subjectId: attSubject,
        courseId: selectedSubObj?.courseId || "MCA",
        semester: selectedSubObj?.semester || 3,
        section: selectedSubObj?.section || "A",
        facultyId: user.uid,
        date: attDate,
        attendanceMode: "manual_mobile",
        status: "completed",
        totalStudents: currentSubjectStudents.length,
        createdAt: serverTimestamp(),
      });

      // Write individual attendance records
      for (const st of currentSubjectStudents) {
        const isPresent = studentAttendanceMap[st.studentId] !== false;
        if (isPresent) presentCount++;
        else absentCount++;

        await addDoc(collection(db, "attendanceRecords"), {
          sessionId: sessionDoc.id,
          subjectId: attSubject,
          courseId: selectedSubObj?.courseId || "MCA",
          semester: selectedSubObj?.semester || 3,
          section: selectedSubObj?.section || "A",
          studentId: st.studentId,
          studentName: st.studentName || "Student",
          facultyId: user.uid,
          date: attDate,
          status: isPresent ? "present" : "absent",
          createdAt: serverTimestamp(),
        });
      }

      await updateDoc(doc(db, "attendanceSessions", sessionDoc.id), {
        presentCount,
        absentCount,
      });

      setActionMsg(`Attendance marked successfully! (${presentCount} Present, ${absentCount} Absent)`);
      loadData();
    } catch (err: any) {
      setActionMsg(err.message || "Failed to mark attendance.");
    } finally {
      setSavingAction(false);
    }
  };

  // Publish Assignment
  const handlePublishAssignment = async () => {
    if (!asgTitle.trim() || !asgDesc.trim() || !asgSubject) {
      setActionMsg("Please fill in assignment title, description and subject.");
      return;
    }

    try {
      setSavingAction(true);
      setActionMsg("");
      const selectedSub = assignedSubjects.find((s) => s.subjectId === asgSubject);

      await addDoc(collection(db, "assignments"), {
        title: asgTitle.trim(),
        description: asgDesc.trim(),
        subjectId: asgSubject,
        courseId: selectedSub?.courseId || "MCA",
        semester: selectedSub?.semester || 3,
        facultyId: user.uid,
        dueDate: asgDueDate || "No deadline",
        status: "active",
        createdAt: serverTimestamp(),
      });

      setAsgTitle("");
      setAsgDesc("");
      setActionMsg("Assignment published successfully to students!");
      loadData();
    } catch (err: any) {
      setActionMsg(err.message || "Failed to publish assignment.");
    } finally {
      setSavingAction(false);
    }
  };

  // Upload Study Material
  const handleUploadMaterial = async () => {
    if (!matTitle.trim() || !matDesc.trim() || !matSubject || !matUrl.trim()) {
      setActionMsg("Please fill in title, description, subject and resource URL.");
      return;
    }

    try {
      setSavingAction(true);
      setActionMsg("");
      const selectedSub = assignedSubjects.find((s) => s.subjectId === matSubject);

      await addDoc(collection(db, "studyMaterials"), {
        title: matTitle.trim(),
        description: matDesc.trim(),
        subjectId: matSubject,
        courseId: selectedSub?.courseId || "MCA",
        semester: selectedSub?.semester || 3,
        facultyId: user.uid,
        fileUrl: matUrl.trim(),
        createdAt: serverTimestamp(),
      });

      setMatTitle("");
      setMatDesc("");
      setMatUrl("");
      setActionMsg("Study material uploaded successfully!");
      loadData();
    } catch (err: any) {
      setActionMsg(err.message || "Failed to upload study material.");
    } finally {
      setSavingAction(false);
    }
  };

  // Evaluate Submission
  const handleEvaluateSubmission = async (sub: any) => {
    const marks = Number(evalMarks[sub.id]);
    const feedback = evalFeedback[sub.id] || "Evaluated by faculty.";

    if (isNaN(marks) || marks < 0 || marks > 100) {
      setActionMsg("Please enter valid marks between 0 and 100.");
      return;
    }

    try {
      setSavingAction(true);
      setActionMsg("");

      await updateDoc(doc(db, "submissions", sub.id), {
        marks,
        feedback,
        status: "evaluated",
        evaluatedAt: serverTimestamp(),
        evaluatedBy: user.uid,
      });

      setActionMsg(`Submission graded successfully: ${marks} / 100`);
      loadData();
    } catch (err: any) {
      setActionMsg(err.message || "Failed to update submission evaluation.");
    } finally {
      setSavingAction(false);
    }
  };

  // Publish Announcement
  const handlePublishAnnouncement = async () => {
    if (!annTitle.trim() || !annDesc.trim()) {
      setActionMsg("Please enter an announcement title and description.");
      return;
    }

    try {
      setSavingAction(true);
      setActionMsg("");

      await addDoc(collection(db, "announcements"), {
        title: annTitle.trim(),
        description: annDesc.trim(),
        priority: annPriority,
        section: annSection,
        courseId: "MCA",
        semester: 3,
        status: "published",
        createdBy: user.uid,
        authorName: profile?.fullName || "Faculty Member",
        createdAt: serverTimestamp(),
      });

      setAnnTitle("");
      setAnnDesc("");
      setActionMsg("Announcement broadcasted successfully to students!");
      loadData();
    } catch (err: any) {
      setActionMsg(err.message || "Failed to publish announcement.");
    } finally {
      setSavingAction(false);
    }
  };

  // Render Tab Content
  const renderContent = () => {
    if (loading && !refreshing) {
      return (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#1e3a8a" />
          <Text style={styles.loadingText}>Loading faculty management data...</Text>
        </View>
      );
    }

    switch (activeTab) {
      case "dashboard":
        return (
          <View>
            <View style={styles.banner}>
              <Text style={styles.bannerGreeting}>
                Welcome, {profile?.fullName || "Faculty"}! 👨‍🏫
              </Text>
              <Text style={styles.bannerSub}>Faculty Academic Management Portal</Text>
            </View>

            {/* Live Statistics Cards */}
            <View style={styles.statsRow}>
              <View style={[styles.statBox, { borderLeftColor: "#2563eb" }]}>
                <Text style={styles.statEmoji}>📚</Text>
                <Text style={styles.statLabel}>Assigned Subjects</Text>
                <Text style={styles.statValue}>{assignedSubjects.length}</Text>
              </View>

              <View style={[styles.statBox, { borderLeftColor: "#10b981" }]}>
                <Text style={styles.statEmoji}>👨‍🎓</Text>
                <Text style={styles.statLabel}>Students Enrolled</Text>
                <Text style={styles.statValue}>{uniqueStudents}</Text>
              </View>
            </View>

            <View style={styles.statsRow}>
              <View style={[styles.statBox, { borderLeftColor: "#8b5cf6" }]}>
                <Text style={styles.statEmoji}>📊</Text>
                <Text style={styles.statLabel}>Attendance Sessions</Text>
                <Text style={styles.statValue}>{attendanceSessions.length}</Text>
              </View>

              <View style={[styles.statBox, { borderLeftColor: "#f59e0b" }]}>
                <Text style={styles.statEmoji}>📝</Text>
                <Text style={styles.statLabel}>Submissions</Text>
                <Text style={styles.statValue}>{submissions.length}</Text>
              </View>
            </View>

            {/* Quick Actions Grid */}
            <Text style={styles.sectionTitle}>⚡ Faculty Actions</Text>
            <View style={styles.quickGrid}>
              <TouchableOpacity style={styles.quickCard} onPress={() => setActiveTab("attendance")}>
                <Text style={styles.quickEmoji}>📊</Text>
                <Text style={styles.quickText}>Mark Attendance</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickCard} onPress={() => setActiveTab("assignments")}>
                <Text style={styles.quickEmoji}>📝</Text>
                <Text style={styles.quickText}>New Assignment</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickCard} onPress={() => setActiveTab("submissions")}>
                <Text style={styles.quickEmoji}>📋</Text>
                <Text style={styles.quickText}>Grade Submissions</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickCard} onPress={() => setActiveTab("materials")}>
                <Text style={styles.quickEmoji}>📚</Text>
                <Text style={styles.quickText}>Upload Notes</Text>
              </TouchableOpacity>
            </View>
          </View>
        );

      case "subjects":
        return (
          <View>
            <Text style={styles.pageTitle}>📚 My Assigned Subjects ({assignedSubjects.length})</Text>
            {assignedSubjects.length === 0 ? (
              <Text style={styles.emptyText}>No active subjects assigned to your faculty profile.</Text>
            ) : (
              assignedSubjects.map((s) => (
                <View key={s.id} style={styles.cardItem}>
                  <Text style={styles.cardBold}>{s.subjectName || s.subjectId}</Text>
                  <Text style={styles.listSub}>Subject Code: {s.subjectId}</Text>
                  <Text style={styles.cardBody}>
                    Course: {s.courseId || "MCA"} • Semester {s.semester || 3} • Section {s.section || "A"}
                  </Text>
                </View>
              ))
            )}
          </View>
        );

      case "attendance":
        return (
          <View>
            <Text style={styles.pageTitle}>📊 Mark Student Attendance</Text>
            {actionMsg ? (
              <View style={styles.alertBox}>
                <Text style={styles.alertText}>{actionMsg}</Text>
              </View>
            ) : null}

            <View style={styles.cardItem}>
              <Text style={styles.inputLabel}>Subject</Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {assignedSubjects.map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={[
                      styles.pillBtn,
                      attSubject === s.subjectId && styles.pillBtnActive,
                    ]}
                    onPress={() => setAttSubject(s.subjectId)}
                  >
                    <Text
                      style={[
                        styles.pillBtnText,
                        attSubject === s.subjectId && styles.pillBtnTextActive,
                      ]}
                    >
                      {s.subjectId}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.inputLabel}>Date (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.input}
                value={attDate}
                onChangeText={setAttDate}
              />

              <Text style={[styles.inputLabel, { marginTop: 8 }]}>
                Enrolled Students ({currentSubjectStudents.length})
              </Text>
              {currentSubjectStudents.length === 0 ? (
                <Text style={styles.emptyText}>No students enrolled in this subject.</Text>
              ) : (
                currentSubjectStudents.map((st) => {
                  const isPresent = studentAttendanceMap[st.studentId] !== false;
                  return (
                    <TouchableOpacity
                      key={st.id}
                      style={[styles.attStudentRow, isPresent ? styles.attRowPresent : styles.attRowAbsent]}
                      onPress={() => toggleAttendance(st.studentId)}
                    >
                      <View>
                        <Text style={styles.attStudentName}>{st.studentName || st.studentId}</Text>
                        <Text style={styles.attStudentSub}>ID: {st.studentId.slice(0, 10)}...</Text>
                      </View>
                      <Text style={[styles.attBadgeText, isPresent ? { color: "#16a34a" } : { color: "#dc2626" }]}>
                        {isPresent ? "✓ PRESENT" : "✕ ABSENT"}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              )}

              <TouchableOpacity
                style={[styles.submitBtn, savingAction && { backgroundColor: "#93c5fd" }]}
                onPress={handleSaveAttendance}
                disabled={savingAction}
              >
                <Text style={styles.submitBtnText}>
                  {savingAction ? "Saving Attendance..." : "Save Session Attendance"}
                </Text>
              </TouchableOpacity>

              {attendanceSessions.length > 0 && (
                <View style={{ marginTop: 20 }}>
                  <Text style={styles.sectionTitle}>Recent Sessions ({attendanceSessions.length})</Text>
                  {attendanceSessions.slice(0, 5).map((sess) => (
                    <View key={sess.id} style={styles.cardItem}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardBold}>{sess.subjectId || "Subject"}</Text>
                        <Text style={styles.listSub}>
                          Date: {formatDate(sess.date || sess.createdAt)} • Present: {sess.presentCount || 0} / {sess.totalStudents || 0}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        );

      case "assignments":
        return (
          <View>
            <Text style={styles.pageTitle}>📝 Publish Course Assignment</Text>
            {actionMsg ? (
              <View style={styles.alertBox}>
                <Text style={styles.alertText}>{actionMsg}</Text>
              </View>
            ) : null}

            <View style={styles.cardItem}>
              <Text style={styles.inputLabel}>Assignment Title</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Distributed Database Transaction Analysis"
                placeholderTextColor="#94a3b8"
                value={asgTitle}
                onChangeText={setAsgTitle}
              />

              <Text style={styles.inputLabel}>Subject Code</Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {assignedSubjects.map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.pillBtn, asgSubject === s.subjectId && styles.pillBtnActive]}
                    onPress={() => setAsgSubject(s.subjectId)}
                  >
                    <Text style={[styles.pillBtnText, asgSubject === s.subjectId && styles.pillBtnTextActive]}>
                      {s.subjectId}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.inputLabel}>Due Date (e.g. 2026-11-30)</Text>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#94a3b8"
                value={asgDueDate}
                onChangeText={setAsgDueDate}
              />

              <Text style={styles.inputLabel}>Problem Description / Questions</Text>
              <TextInput
                style={[styles.input, { height: 90 }]}
                placeholder="Detail the assignment tasks, submission format, and marking criteria..."
                placeholderTextColor="#94a3b8"
                multiline
                value={asgDesc}
                onChangeText={setAsgDesc}
              />

              <TouchableOpacity
                style={[styles.submitBtn, savingAction && { backgroundColor: "#93c5fd" }]}
                onPress={handlePublishAssignment}
                disabled={savingAction}
              >
                <Text style={styles.submitBtnText}>
                  {savingAction ? "Publishing..." : "Publish Assignment"}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>My Published Assignments ({assignments.length})</Text>
            {assignments.map((a) => (
              <View key={a.id} style={styles.cardItem}>
                <Text style={styles.cardBold}>{a.title}</Text>
                <Text style={styles.listSub}>
                  {a.subjectId} • Due: {formatDate(a.dueDate, "No deadline")}
                  {a.createdAt ? ` • Posted: ${formatDate(a.createdAt)}` : ""}
                </Text>
                <Text style={styles.cardBody}>{a.description}</Text>
              </View>
            ))}
          </View>
        );

      case "submissions":
        return (
          <View>
            <Text style={styles.pageTitle}>📋 Review Student Submissions ({submissions.length})</Text>
            {actionMsg ? (
              <View style={styles.alertBox}>
                <Text style={styles.alertText}>{actionMsg}</Text>
              </View>
            ) : null}

            {submissions.length === 0 ? (
              <Text style={styles.emptyText}>No student submissions received yet.</Text>
            ) : (
              submissions.map((sub) => {
                const isEvaluated = sub.status === "evaluated";
                return (
                  <View key={sub.id} style={styles.cardItem}>
                    <View style={styles.cardHeader}>
                      <Text style={styles.cardBold}>Student: {sub.studentId?.slice(0, 10)}...</Text>
                      <View style={[styles.badge, isEvaluated ? styles.badgeSuccess : styles.badgeWarning]}>
                        <Text style={styles.badgeText}>{isEvaluated ? "Evaluated" : "Pending"}</Text>
                      </View>
                    </View>

                    <Text style={styles.listSub}>
                      Subject: {sub.subjectId || "Course Subject"}
                      {sub.submittedAt ? ` • Submitted: ${formatDate(sub.submittedAt)}` : ""}
                    </Text>

                    <View style={{ backgroundColor: "#f8fafc", padding: 10, borderRadius: 8, marginVertical: 8 }}>
                      <Text style={{ fontWeight: "600", fontSize: 13, color: "#334155" }}>Student Response:</Text>
                      <Text style={{ fontSize: 13, color: "#0f172a", marginTop: 4 }}>
                        {sub.submissionText || "File submitted."}
                      </Text>
                    </View>

                    {/* Evaluation Input */}
                    <Text style={styles.inputLabel}>Grade Marks (0 - 100):</Text>
                    <TextInput
                      style={styles.input}
                      placeholder={sub.marks !== undefined ? String(sub.marks) : "e.g. 85"}
                      placeholderTextColor="#94a3b8"
                      keyboardType="numeric"
                      value={evalMarks[sub.id] || ""}
                      onChangeText={(val) => setEvalMarks((prev) => ({ ...prev, [sub.id]: val }))}
                    />

                    <Text style={styles.inputLabel}>Written Faculty Feedback:</Text>
                    <TextInput
                      style={styles.input}
                      placeholder={sub.feedback || "Enter constructive feedback..."}
                      placeholderTextColor="#94a3b8"
                      value={evalFeedback[sub.id] || ""}
                      onChangeText={(val) => setEvalFeedback((prev) => ({ ...prev, [sub.id]: val }))}
                    />

                    <TouchableOpacity
                      style={styles.submitBtn}
                      onPress={() => handleEvaluateSubmission(sub)}
                      disabled={savingAction}
                    >
                      <Text style={styles.submitBtnText}>
                        {isEvaluated ? "Update Grade & Feedback" : "Save Evaluation"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
          </View>
        );

      case "materials":
        return (
          <View>
            <Text style={styles.pageTitle}>📚 Upload Study Material</Text>
            {actionMsg ? (
              <View style={styles.alertBox}>
                <Text style={styles.alertText}>{actionMsg}</Text>
              </View>
            ) : null}

            <View style={styles.cardItem}>
              <Text style={styles.inputLabel}>Material Title</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Module 3: Distributed Systems Architecture"
                placeholderTextColor="#94a3b8"
                value={matTitle}
                onChangeText={setMatTitle}
              />

              <Text style={styles.inputLabel}>Subject Code</Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {assignedSubjects.map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.pillBtn, matSubject === s.subjectId && styles.pillBtnActive]}
                    onPress={() => setMatSubject(s.subjectId)}
                  >
                    <Text style={[styles.pillBtnText, matSubject === s.subjectId && styles.pillBtnTextActive]}>
                      {s.subjectId}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.inputLabel}>Document / Resource Link</Text>
              <TextInput
                style={styles.input}
                placeholder="Cloud storage, Google Drive, or document URL"
                placeholderTextColor="#94a3b8"
                value={matUrl}
                onChangeText={setMatUrl}
              />

              <Text style={styles.inputLabel}>Material Description</Text>
              <TextInput
                style={[styles.input, { height: 75 }]}
                placeholder="Summary of topics covered..."
                placeholderTextColor="#94a3b8"
                multiline
                value={matDesc}
                onChangeText={setMatDesc}
              />

              <TouchableOpacity
                style={[styles.submitBtn, savingAction && { backgroundColor: "#93c5fd" }]}
                onPress={handleUploadMaterial}
                disabled={savingAction}
              >
                <Text style={styles.submitBtnText}>
                  {savingAction ? "Uploading..." : "Upload Learning Material"}
                </Text>
              </TouchableOpacity>
            </View>

            {materials.length > 0 && (
              <View style={{ marginTop: 10 }}>
                <Text style={styles.sectionTitle}>Uploaded Notes & Documents ({materials.length})</Text>
                {materials.map((m) => (
                  <View key={m.id} style={styles.cardItem}>
                    <Text style={styles.cardBold}>{m.title}</Text>
                    <Text style={styles.listSub}>
                      Subject: {m.subjectId}
                      {m.createdAt ? ` • Uploaded: ${formatDate(m.createdAt)}` : ""}
                    </Text>
                    <Text style={styles.cardBody}>{m.description}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        );

      case "announcements":
        return (
          <View>
            <Text style={styles.pageTitle}>📢 Broadcast Announcement</Text>
            {actionMsg ? (
              <View style={styles.alertBox}>
                <Text style={styles.alertText}>{actionMsg}</Text>
              </View>
            ) : null}

            <View style={styles.cardItem}>
              <Text style={styles.inputLabel}>Announcement Headline</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Mid-term Exam Schedule Announced"
                placeholderTextColor="#94a3b8"
                value={annTitle}
                onChangeText={setAnnTitle}
              />

              <Text style={styles.inputLabel}>Priority Level</Text>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                {["normal", "high", "urgent"].map((lvl) => (
                  <TouchableOpacity
                    key={lvl}
                    style={[styles.pillBtn, annPriority === lvl && styles.pillBtnActive]}
                    onPress={() => setAnnPriority(lvl)}
                  >
                    <Text style={[styles.pillBtnText, annPriority === lvl && styles.pillBtnTextActive]}>
                      {lvl.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.inputLabel}>Announcement Content</Text>
              <TextInput
                style={[styles.input, { height: 90 }]}
                placeholder="Type the full message..."
                placeholderTextColor="#94a3b8"
                multiline
                value={annDesc}
                onChangeText={setAnnDesc}
              />

              <TouchableOpacity
                style={[styles.submitBtn, savingAction && { backgroundColor: "#93c5fd" }]}
                onPress={handlePublishAnnouncement}
                disabled={savingAction}
              >
                <Text style={styles.submitBtnText}>
                  {savingAction ? "Broadcasting..." : "Broadcast Notice"}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>My Published Notices ({announcements.length})</Text>
            {announcements.map((a) => (
              <View key={a.id} style={styles.cardItem}>
                <Text style={styles.cardBold}>{a.title}</Text>
                {a.createdAt || a.date ? (
                  <Text style={styles.listSub}>Broadcast: {formatDate(a.createdAt || a.date)}</Text>
                ) : null}
                <Text style={styles.cardBody}>{a.description}</Text>
              </View>
            ))}
          </View>
        );

      case "profile":
        return (
          <View style={styles.profileCard}>
            <View style={[styles.profileAvatar, { backgroundColor: "#1e3a8a" }]}>
              <Text style={styles.avatarLetter}>
                {(profile?.fullName || "F").charAt(0).toUpperCase()}
              </Text>
            </View>

            <Text style={styles.profileName}>{profile?.fullName || "Faculty Member"}</Text>
            <Text style={styles.profileEmail}>{profile?.email || user.email}</Text>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Role:</Text>
              <Text style={styles.detailValue}>Faculty Member</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Assigned Subjects:</Text>
              <Text style={styles.detailValue}>{assignedSubjects.length} Active Courses</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Faculty UID:</Text>
              <Text style={[styles.detailValue, { fontSize: 11 }]}>{user.uid}</Text>
            </View>

            <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
              <Text style={styles.logoutBtnText}>↪ Sign Out of Faculty App</Text>
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
          <Text style={styles.headerSub}>Faculty Management Portal</Text>
        </View>
        <TouchableOpacity style={styles.headerProfileBtn} onPress={() => setActiveTab("profile")}>
          <Text style={styles.headerProfileLetter}>
            {(profile?.fullName || "F").charAt(0).toUpperCase()}
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

      {/* Bottom Navigation */}
      <View style={styles.bottomNav}>
        {[
          { tab: "dashboard", label: "Dashboard", icon: "🏠" },
          { tab: "attendance", label: "Attendance", icon: "📊" },
          { tab: "assignments", label: "Assignments", icon: "📝" },
          { tab: "submissions", label: "Evaluate", icon: "📋" },
          { tab: "profile", label: "Profile", icon: "👤" },
        ].map((item) => (
          <TouchableOpacity
            key={item.tab}
            style={[styles.navBtn, activeTab === item.tab && styles.navBtnActive]}
            onPress={() => setActiveTab(item.tab as FacultyTab)}
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
    backgroundColor: "#0f172a",
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
    color: "#94a3b8",
  },
  headerProfileBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1e3a8a",
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
    backgroundColor: "#1e3a8a",
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
    color: "#bfdbfe",
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
    fontSize: 11,
    fontWeight: "600",
    color: "#334155",
    textAlign: "center",
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
  listSub: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 2,
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
    paddingVertical: 9,
    fontSize: 13,
    color: "#0f172a",
    backgroundColor: "#f8fafc",
    marginBottom: 12,
  },
  pillBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#f8fafc",
  },
  pillBtnActive: {
    borderColor: "#2563eb",
    backgroundColor: "#eff6ff",
  },
  pillBtnText: {
    fontSize: 12,
    color: "#475569",
    fontWeight: "500",
  },
  pillBtnTextActive: {
    color: "#1d4ed8",
    fontWeight: "bold",
  },
  attStudentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
  },
  attRowPresent: {
    backgroundColor: "#f0fdf4",
    borderColor: "#bbf7d0",
  },
  attRowAbsent: {
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca",
  },
  attStudentName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
  attStudentSub: {
    fontSize: 11,
    color: "#64748b",
    marginTop: 2,
  },
  attBadgeText: {
    fontSize: 12,
    fontWeight: "bold",
  },
  submitBtn: {
    backgroundColor: "#1e3a8a",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  submitBtnText: {
    color: "#ffffff",
    fontWeight: "bold",
    fontSize: 14,
  },
  alertBox: {
    backgroundColor: "#eff6ff",
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  alertText: {
    color: "#1d4ed8",
    fontSize: 13,
    fontWeight: "500",
  },
  emptyText: {
    textAlign: "center",
    color: "#94a3b8",
    paddingVertical: 30,
    fontSize: 14,
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
  badgeWarning: {
    backgroundColor: "#fef3c7",
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
    color: "#1e3a8a",
    fontWeight: "bold",
  },
});
