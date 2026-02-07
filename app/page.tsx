
"use client";

import React, { useEffect } from 'react';
import { useSession, signIn } from "next-auth/react";
import { useRouter } from 'next/navigation';
import { SparklesIcon } from '@heroicons/react/24/outline';

export default function LandingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Automatically redirect to /ai if authenticated
  useEffect(() => {
    if (status === "authenticated") {
      router.replace('/ai');
    }
  }, [status, router]);

  if (status === "loading" || status === "authenticated") {
    return (
      <div className="h-[100dvh] flex items-center justify-center bg-[#f8fafc]">
        <div className="flex flex-col items-center gap-4">
          <SparklesIcon className="w-12 h-12 text-blue-600 animate-bounce" />
          <p className="text-slate-500 font-bold">Redirecting to Chronos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex items-center justify-center bg-[#f8fafc] p-6 overflow-hidden">
      <div className="max-w-md w-full bg-white p-8 lg:p-12 rounded-[2.5rem] shadow-2xl border border-slate-100 text-center space-y-8 animate-in fade-in zoom-in duration-500">
        <div className="w-20 h-20 lg:w-24 lg:h-24 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl flex items-center justify-center text-white text-4xl lg:text-5xl font-bold mx-auto shadow-2xl rotate-3">C</div>
        
        <div className="space-y-2">
          <h1 className="text-3xl lg:text-4xl font-extrabold text-slate-900 tracking-tight">Chronos AI</h1>
          <p className="text-slate-500 font-medium">Your schedule, simplified by intelligence.</p>
        </div>

        <div className="space-y-4">
          <button 
            onClick={() => signIn('google')} 
            className="w-full bg-slate-900 text-white py-4 px-6 rounded-2xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-3 shadow-lg active:scale-95"
          >
            Sign in with Google
          </button>
          
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
            Powered by Google Calendar & Gemini
          </p>
        </div>
      </div>
    </div>
  );
}
