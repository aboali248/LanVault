import type { AppSettings } from '../../types';
import { useApp } from '../../contexts/AppContext';
import { apiBaseUrl } from '../../services/api';

export function ServerSettings({ value }: { value: AppSettings['server'] & AppSettings['network'] }) {
  const { t, language } = useApp();
  const serverUrl = new URL(apiBaseUrl);
  const advertisedAddress = value.advertisedAddress?.trim() || `${serverUrl.protocol}//${serverUrl.hostname}:${value.port}`;
  return <section className="surface p-5"><header className="mb-4"><h2 className="font-bold">{t('serverSettings')}</h2><p className="mt-1 text-xs text-slate-500">{language === 'ar' ? 'تُكتشف إعدادات الاتصال تلقائيًا من تشغيل الخادم. عنوان الربط والمنفذ للعرض فقط.' : 'Connection settings are detected from the running server. Bind address and port are display-only.'}</p></header>
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="label">{language === 'ar' ? 'عنوان الربط' : 'Bind address'}<input className="input mt-1.5 opacity-75" dir="ltr" value={value.host} readOnly /></label>
      <label className="label">{language === 'ar' ? 'المنفذ' : 'Port'}<input type="number" className="input mt-1.5 opacity-75" dir="ltr" value={value.port} readOnly /></label>
      <label className="label">{language === 'ar' ? 'عنوان Agent التلقائي' : 'Automatic Agent address'}<input className="input mt-1.5 opacity-75" dir="ltr" value={advertisedAddress} readOnly /></label>
    </div>
  </section>;
}
