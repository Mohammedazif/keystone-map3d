'use client';

import { create } from 'zustand';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  actions: {
    setUser: (user: User | null) => void;
  };
}

const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  actions: {
    setUser: (user) => set({ user }),
  },
}));

let unsub: (() => void) | null = null;

if (typeof window !== 'undefined' && !unsub) {
  unsub = onAuthStateChanged(auth, (user) => {
    useAuthStore.getState().actions.setUser(user);
    useAuthStore.setState({ isLoading: false });
  });
}


export const useAuth = () => {
  const user = useAuthStore(state => state.user);
  const isLoading = useAuthStore(state => state.isLoading);
  return { user, isLoading };
}

export default useAuthStore;
