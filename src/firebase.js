import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth, signInAnonymously } from 'firebase/auth'

// ⬇️ AQUÍ van las claves que copies de la consola de Firebase.
// (Angel pegará el firebaseConfig real en este objeto.)
const firebaseConfig = {
  apiKey: 'AIzaSyDiNSjJGDOJi9eKvwRYHCMij8w2PuRHRpk',
  authDomain: 'nuestroahorro-8ec63.firebaseapp.com',
  projectId: 'nuestroahorro-8ec63',
  storageBucket: 'nuestroahorro-8ec63.firebasestorage.app',
  messagingSenderId: '141554832618',
  appId: '1:141554832618:web:9f617b9698d9f4fbe9f393',
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const auth = getAuth(app)

// Login anónimo: protege los datos pero sin que ustedes tengan que crear cuentas.
export const listoFirebase = signInAnonymously(auth).catch((e) => {
  console.error('Error iniciando sesión en Firebase:', e)
})
