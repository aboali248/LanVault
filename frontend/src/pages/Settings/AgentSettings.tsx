import type { AppSettings } from '../../types';
import { useApp } from '../../contexts/AppContext';

export function AgentSettings({ value, onChange }: { value: AppSettings['agent']; onChange: (value: Partial<AppSettings['agent']>) => void }) {
  const { t, language } = useApp();
  return <section className="surface p-5"><header className="mb-4"><h2 className="font-bold">{t('agentSettings')}</h2><p className="mt-1 text-xs text-slate-500">{language === 'ar' ? 'مهلة انقطاع الاتصال قبل اعتبار الجهاز غير متصل.' : 'Time without heartbeat before a device is considered offline.'}</p></header>
    <label className="label max-w-sm">{language === 'ar' ? 'مهلة Heartbeat (ثانية)' : 'Heartbeat timeout (seconds)'}<input type="number" min="5" max="3600" className="input mt-1.5" value={value.heartbeatTimeoutSeconds} onChange={(event) => onChange({ heartbeatTimeoutSeconds: Number(event.target.value) })} /></label>
    <p className="mt-3 text-xs text-slate-500">{language === 'ar' ? 'تسجيل Agent جديد يتطلب AGENT_BOOTSTRAP_TOKEN على الخادم؛ لا يُخزن الرمز في إعدادات الواجهة.' : 'New agent enrollment requires AGENT_BOOTSTRAP_TOKEN on the server; the token is never stored in this UI.'}</p>
  </section>;
}
