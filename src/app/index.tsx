import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
} from "react-native";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "../firebase";
import AuthScreen from "../components/AuthScreen";
import StudentPortal from "../components/StudentPortal";
import FacultyPortal from "../components/FacultyPortal";
import {
  configureForegroundNotifications,
  registerForPushNotificationsAsync,
  cleanupMobileToken,
  addNotificationResponseListener,
  addForegroundNotificationListener,
} from "../services/fcmService";

// Configure how notifications appear while the app is in the foreground
configureForegroundNotifications();

export default function AppEntry() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Refs to hold notification subscriptions so they can be removed on unmount
  const responseListenerRef = useRef<any>(null);
  const foregroundListenerRef = useRef<any>(null);

  // ── FCM: register token when user is set ────────────────────────────────
  useEffect(() => {
    if (!currentUser) return;

    registerForPushNotificationsAsync(currentUser.uid).catch((err) => {
      console.warn("[FCM] Push registration non-fatal error:", err);
    });

    // Foreground notification received
    try {
      foregroundListenerRef.current = addForegroundNotificationListener(
        (notification) => {
          console.log("[FCM] Foreground notification:", notification);
          // StudentPortal / FacultyPortal handle their own notification state.
          // A toast or in-app alert could be shown here.
        }
      );
    } catch (err) {
      console.warn("[FCM] Foreground listener setup non-fatal error:", err);
    }

    // User tapped a notification — handle deep linking
    try {
      responseListenerRef.current = addNotificationResponseListener(
        (response) => {
          const data = response?.notification?.request?.content?.data || {};
          console.log("[FCM] Notification tapped, data:", data);
          // Deep-link routing can be extended here based on data.type:
          // e.g., "assignment", "announcement", "submission", "event"
        }
      );
    } catch (err) {
      console.warn("[FCM] Response listener setup non-fatal error:", err);
    }

    return () => {
      try {
        responseListenerRef.current?.remove();
        foregroundListenerRef.current?.remove();
      } catch (err) {
        console.warn("[FCM] Listener removal non-fatal error:", err);
      }
    };
  }, [currentUser]);

  // ── Auth state listener ─────────────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          setCurrentUser(user);
          const userDoc = await getDoc(doc(db, "users", user.uid));
          if (userDoc.exists()) {
            setProfile(userDoc.data());
          } else {
            // Default student fallback if profile doc is being created
            setProfile({
              role: "student",
              fullName:
                user.displayName || user.email?.split("@")[0] || "Student",
              email: user.email,
              courseId: "MCA",
              semester: 3,
              section: "A",
            });
          }
        } else {
          setCurrentUser(null);
          setProfile(null);
        }
      } catch (err) {
        console.error("Auth state error:", err);
        setCurrentUser(null);
        setProfile(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // ── Logout handler passed to portals ────────────────────────────────────
  const handleLogout = async () => {
    if (currentUser) {
      await cleanupMobileToken(currentUser.uid);
    }
    await auth.signOut();
  };

  if (loading) {
    return (
      <View style={styles.centerBox}>
        <View style={styles.brandBadge}>
          <Text style={styles.brandLetter}>C</Text>
        </View>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.splashText}>Connecting to CampusConnect 360...</Text>
      </View>
    );
  }

  if (!currentUser) {
    return <AuthScreen onLoginSuccess={() => setLoading(true)} />;
  }

  if (profile?.status && profile.status !== "active") {
    return (
      <View style={styles.centerBox}>
        <View style={[styles.brandBadge, { backgroundColor: "#dc2626" }]}>
          <Text style={styles.brandLetter}>⚠️</Text>
        </View>
        <Text style={{ fontSize: 18, fontWeight: "bold", color: "#1e293b", marginBottom: 8 }}>
          Account Inactive
        </Text>
        <Text style={{ fontSize: 14, color: "#64748b", textAlign: "center", marginBottom: 20 }}>
          Your CampusConnect 360 account is inactive. Please contact the campus administrator.
        </Text>
        <TouchableOpacity
          style={{ backgroundColor: "#2563eb", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 }}
          onPress={handleLogout}
        >
          <Text style={{ color: "#ffffff", fontWeight: "600" }}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (profile?.role === "faculty") {
    return (
      <FacultyPortal
        user={currentUser}
        profile={profile}
        onLogout={handleLogout}
      />
    );
  }

  // Default to Student Portal (handles 'student' and general accounts)
  return (
    <StudentPortal
      user={currentUser}
      profile={profile}
      onLogout={handleLogout}
    />
  );
}

const styles = StyleSheet.create({
  centerBox: {
    flex: 1,
    backgroundColor: "#f4f7fc",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  brandBadge: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: "#2563eb",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    shadowColor: "#2563eb",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  brandLetter: {
    color: "#ffffff",
    fontSize: 34,
    fontWeight: "bold",
  },
  splashText: {
    marginTop: 16,
    color: "#64748b",
    fontSize: 14,
    fontWeight: "500",
  },
});
