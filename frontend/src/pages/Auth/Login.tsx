import { useState } from 'react';
import { Button } from '../../components/Button';
import { Select } from '../../components/Select';
import { useApp } from '../../contexts/AppContext';
import { useAuth } from '../../contexts/AuthContext';

export function Login() {
  const { language, setLanguage } = useApp();
  const { signIn } = useAuth();
  const [username, setUsername] = useState<'admin' | 'user'>('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const isArabic = language === 'ar';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await signIn(username, password);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (isArabic ? 'تعذر تسجيل الدخول' : 'Could not sign in'));
    } finally {
      setLoading(false);
    }
  };

  return <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#09090b] px-4 py-10 text-slate-100">
    <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-orange-500/10 blur-3xl" />
    <div className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-orange-700/10 blur-3xl" />
    <button type="button" onClick={() => setLanguage(isArabic ? 'en' : 'ar')} className="absolute right-5 top-5 rounded-xl border border-slate-800 px-3 py-2 text-xs font-bold text-slate-300 hover:border-orange-500/50">{isArabic ? 'EN' : 'ع'}</button>
    <section className="relative w-full max-w-md rounded-[2rem] border border-slate-800 bg-[#111113] p-7 shadow-2xl shadow-black/50 sm:p-9">
      <div className="mb-8 flex items-center gap-3">
        <img src="/logo1.png" alt="LanVault" className="h-12 w-12 rounded-2xl object-contain" />
        <div><p className="text-xl font-black tracking-tight">LanVault</p><p className="text-xs text-slate-500">{isArabic ? 'إدارة النسخ الاحتياطي عبر الشبكة' : 'LAN backup management'}</p></div>
      </div>
      <h1 className="text-2xl font-bold">{isArabic ? 'تسجيل الدخول' : 'Sign in'}</h1>
      <p className="mt-2 text-sm text-slate-400">{isArabic ? 'أدخل بيانات حسابك للمتابعة.' : 'Enter your account credentials to continue.'}</p>
      <form onSubmit={(event) => void submit(event)} className="mt-7 space-y-5">
        <label className="label text-slate-300">{isArabic ? 'نوع الحساب' : 'Account'}
          <Select className="mt-1.5 border-slate-700 bg-[#09090b] text-slate-100 focus:border-orange-500 focus:ring-orange-500/10" value={username} onValueChange={(value) => setUsername(value as 'admin' | 'user')} options={[
            { value: 'admin', label: isArabic ? 'مدير النظام' : 'Administrator' },
            { value: 'user', label: isArabic ? 'مستخدم الجهاز' : 'Device user' },
          ]} />
        </label>
        <label className="label text-slate-300">{isArabic ? 'كلمة المرور' : 'Password'}
          <input autoComplete="current-password" required type="password" className="input mt-1.5 border-slate-700 bg-[#09090b] text-slate-100 focus:border-orange-500 focus:ring-orange-500/10" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={isArabic ? 'كلمة المرور' : 'Password'} />
        </label>
        {error && <p role="alert" className="rounded-xl border border-rose-900/70 bg-rose-950/40 px-3 py-2.5 text-sm text-rose-300">{error}</p>}
        <Button type="submit" loading={loading} className="w-full !bg-orange-500 !text-black hover:!bg-orange-400">{isArabic ? 'دخول آمن' : 'Sign in securely'}</Button>
      </form>
    </section>
  </main>;
}
