/**
 * Mobile FCM / Push Notification Service
 *
 * IMPORTANT: Full remote push notifications require a native build (EAS Build / expo run:android).
 * Remote notifications are not supported in Expo Go on Android / iOS (SDK 51+ / SDK 58).
 * In Expo Go, remote push notification registration, FCM token retrieval, and
 * Android notification channel setup are safely skipped to prevent crashes.
 *
 * Full functionality is preserved for development and production builds.
 */

import { doc, updateDoc, getDoc } from "firebase/firestore";
import Constants, { AppOwnership, ExecutionEnvironment } from "expo-constants";
import { db } from "../firebase";

// Conditionally import expo-notifications, expo-device, and Platform to prevent runtime crashes
let Notifications: any = null;
let Device: any = null;
let Platform: any = null;

try {
  Notifications = require("expo-notifications");
  Device = require("expo-device");
  Platform = require("react-native").Platform;
} catch {
  console.warn(
    "[FCM] expo-notifications / expo-device not available. Push notifications require a native build."
  );
}

/**
 * Detect whether the app is currently running inside Expo Go.
 */
export function isExpoGo(): boolean {
  try {
    const appOwnership = Constants?.appOwnership;
    const executionEnvironment = Constants?.executionEnvironment;

    return (
      appOwnership === "expo" ||
      appOwnership === AppOwnership.Expo ||
      executionEnvironment === ExecutionEnvironment.StoreClient ||
      (executionEnvironment as string) === "storeClient" ||
      Boolean((Constants as any)?.expoGoConfig)
    );
  } catch {
    return false;
  }
}

/**
 * Set foreground notification handler (show notification while app is open).
 * Safely guarded so errors never crash the app.
 */
export function configureForegroundNotifications(): void {
  try {
    if (!Notifications || typeof Notifications.setNotificationHandler !== "function") {
      return;
    }
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch (err: any) {
    console.warn("[FCM] Failed to configure foreground notifications:", err?.message || err);
  }
}

/**
 * Request push notification permission and register the device token.
 * Saves the Expo push token to Firestore: users/{uid}.fcmTokens.mobile
 *
 * When running in Expo Go on Android, remote push registration, FCM token retrieval,
 * and setNotificationChannelAsync are safely skipped to avoid NullPointerException.
 *
 * @returns Expo push token string or null
 */
export async function registerForPushNotificationsAsync(
  uid: string
): Promise<string | null> {
  try {
    if (!uid) return null;

    if (!Notifications || !Device) {
      console.warn("[FCM] Push notifications require expo-notifications and expo-device.");
      return null;
    }

    // Physical device required (simulators do not support remote push)
    if (!Device.isDevice) {
      console.warn(
        "[FCM] Push notifications work only on physical devices, not simulators."
      );
      return null;
    }

    // When running inside Expo Go on Android, skip remote push notification registration,
    // FCM token retrieval, and setNotificationChannelAsync to avoid NullPointerException.
    if (isExpoGo()) {
      if (Platform?.OS === "android") {
        console.info(
          "[FCM] Running inside Expo Go on Android: remote push notifications, FCM token retrieval, and setNotificationChannelAsync are skipped."
        );
      } else {
        console.info(
          "[FCM] Running inside Expo Go: remote push notification registration is skipped."
        );
      }
      return null;
    }

    // Request notification permission safely
    let finalStatus = "undetermined";
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      finalStatus = existingStatus;

      if (existingStatus !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
    } catch (permErr: any) {
      console.warn("[FCM] Permission request failed:", permErr?.message || permErr);
      return null;
    }

    if (finalStatus !== "granted") {
      console.info("[FCM] Push notification permission not granted.");
      return null;
    }

    // Android channel (required for Android 8+ in standalone/development builds)
    if (Platform?.OS === "android") {
      try {
        if (typeof Notifications.setNotificationChannelAsync === "function") {
          await Notifications.setNotificationChannelAsync("default", {
            name: "CampusConnect 360",
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: "#2563eb",
          });
        }
      } catch (channelErr: any) {
        console.warn(
          "[FCM] Failed to set notification channel:",
          channelErr?.message || channelErr
        );
      }
    }

    // Get Expo push token (works in standalone and development builds)
    try {
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: undefined, // Uses app.json's configuration automatically
      });
      const token = tokenData?.data || null;

      if (token) {
        try {
          const userRef = doc(db, "users", uid);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            await updateDoc(userRef, { "fcmTokens.mobile": token });
          }
          console.info("[FCM] Mobile push token registered:", token);
        } catch (dbErr: any) {
          console.warn("[FCM] Failed to save mobile token to Firestore:", dbErr?.message || dbErr);
        }
      }

      return token;
    } catch (tokenErr: any) {
      console.warn("[FCM] Mobile push token retrieval failed:", tokenErr?.message || tokenErr);
      return null;
    }
  } catch (err: any) {
    console.warn("[FCM] Unexpected error in registerForPushNotificationsAsync:", err?.message || err);
    return null;
  }
}

/**
 * Remove mobile FCM token from Firestore on logout.
 */
export async function cleanupMobileToken(uid: string): Promise<void> {
  if (!uid) return;
  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      await updateDoc(userRef, { "fcmTokens.mobile": null });
    }
    console.info("[FCM] Mobile push token removed on logout.");
  } catch (err: any) {
    console.warn("[FCM] Mobile token cleanup failed:", err?.message || err);
  }
}

/**
 * Add a listener for notification responses (user tapped a notification).
 * The returned subscription must be removed on unmount.
 *
 * @param handler - called with the notification response
 */
export function addNotificationResponseListener(
  handler: (response: any) => void
): { remove: () => void } {
  try {
    if (
      !Notifications ||
      typeof Notifications.addNotificationResponseReceivedListener !== "function"
    ) {
      return { remove: () => {} };
    }
    // Skip in Expo Go on Android to prevent listener crashes
    if (isExpoGo() && Platform?.OS === "android") {
      return { remove: () => {} };
    }
    const subscription = Notifications.addNotificationResponseReceivedListener(handler);
    return subscription ?? { remove: () => {} };
  } catch (err: any) {
    console.warn("[FCM] Error adding response listener:", err?.message || err);
    return { remove: () => {} };
  }
}

/**
 * Add a listener for foreground notifications (notification arrived while app is open).
 */
export function addForegroundNotificationListener(
  handler: (notification: any) => void
): { remove: () => void } {
  try {
    if (
      !Notifications ||
      typeof Notifications.addNotificationReceivedListener !== "function"
    ) {
      return { remove: () => {} };
    }
    // Skip in Expo Go on Android to prevent listener crashes
    if (isExpoGo() && Platform?.OS === "android") {
      return { remove: () => {} };
    }
    const subscription = Notifications.addNotificationReceivedListener(handler);
    return subscription ?? { remove: () => {} };
  } catch (err: any) {
    console.warn("[FCM] Error adding foreground listener:", err?.message || err);
    return { remove: () => {} };
  }
}
