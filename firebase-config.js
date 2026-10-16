// Firebase Realtime Database 설정 파일
// 깃허브 페이지 배포 시 이 파일에 정보를 직접 입력하거나, 
// 웹 앱 우측 상단 '설정(⚙️)' 메뉴에서 브라우저에 바로 저장할 수 있습니다.

export const defaultFirebaseConfig = {
  apiKey: "AIzaSyCjP0tkaTlKFJa1pPwtOsN3JYGW8Kqh0HA",
  authDomain: "show-handicap.firebaseapp.com",
  databaseURL: "https://show-handicap-default-rtdb.firebaseio.com",
  projectId: "show-handicap",
  storageBucket: "show-handicap.firebasestorage.app",
  messagingSenderId: "211876004571",
  appId: "1:211876004571:web:54137f11e38e99d5e442fe"
};

// 로컬 스토리지에 저장된 설정이 있으면 우선 사용
export function getFirebaseConfig() {
  const saved = localStorage.getItem("show_handicap_firebase_config") || localStorage.getItem("clash_handicap_firebase_config");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.databaseURL) {
        return parsed;
      }
    } catch (e) {
      console.warn("로컬 설정 파싱 실패:", e);
    }
  }
  return defaultFirebaseConfig;
}

export function saveFirebaseConfig(config) {
  localStorage.setItem("show_handicap_firebase_config", JSON.stringify(config));
}
