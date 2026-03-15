import { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  orderBy,
  DocumentData
} from 'firebase/firestore';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  return { user, loading };
}

export function useFirestoreCollection<T = DocumentData>(
  collectionPath: string,
  queryConstraints: any[] = [],
  enabled: boolean = true
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const q = query(collection(db, collectionPath), ...queryConstraints);
    
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data()
        })) as T[];
        setData(items);
        setLoading(false);
      },
      (err) => {
        // Only log if it's not a permission error during initial load/logout
        if (err.code !== 'permission-denied' || enabled) {
          console.error(`Firestore error in ${collectionPath}:`, err);
          setError(err);
        }
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [collectionPath, JSON.stringify(queryConstraints), enabled]);

  return { data, loading, error };
}
