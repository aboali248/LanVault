import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Select } from '../../components/Select';
import { useApp } from '../../contexts/AppContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../services/api';
import type { Device } from '../../types';

export function DeviceArchiveSettings({ device }: { device: Device }) {
  const { language } = useApp();
  const { notify } = useToast();
  const ar = language === 'ar';
  const [mode, setMode] = useState<'off' | 'zip'>(device.archiveMode ?? 'off');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMode(device.archiveMode ?? 'off');
    setPassword('');
  }, [device.id, device.archiveMode]);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.updateDeviceArchive(device.id, mode, mode === 'zip' ? password || null : null);
      setMode(updated.archiveMode);
      setPassword('');
      notify(ar ? 'تم حفظ إعداد الأرشفة' : 'Archive setting saved', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : (ar ? 'تعذر حفظ الأرشفة' : 'Could not save archive setting'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return <section className="mt-4 min-w-0 rounded-xl border border-slate-200 p-4 dark:border-slate-800 lg:col-span-2">
    <h3 className="text-sm font-bold">{ar ? 'الأرشفة المضغوطة (ZIP)' : 'Compressed archives (ZIP)'}</h3>
    <p className="mt-1 text-xs leading-5 text-slate-500">
      {ar
        ? 'عند التفعيل تُحفظ نسخة كل ملف بصيغة zip بجانب مسارها (بكلمة سر اختيارية AES-256 تُفتح بـ 7-Zip). اترك كلمة السر فارغة لأرشيف بدون تشفير، وستُمسح عند الحفظ.'
        : 'When enabled, every file is also stored as a .zip next to its path (optional AES-256 password, open with 7-Zip). Leave the password empty for unencrypted archives; it is cleared on save.'}
    </p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="label">{ar ? 'وضع الأرشفة' : 'Archive mode'}
        <Select
          className="mt-1.5"
          value={mode}
          onValueChange={(value) => setMode(value as 'off' | 'zip')}
          options={[
            { value: 'off', label: ar ? 'إيقاف (خيار)' : 'Off (optional)' },
            { value: 'zip', label: ar ? 'ملف مضغوط لكل ملف' : 'Compressed file per file' },
          ]}
          ariaLabel={ar ? 'وضع الأرشفة' : 'Archive mode'}
        />
      </label>
      <label className="label">{ar ? 'كلمة السر (اختياري)' : 'Password (optional)'}
        <input
          type="password"
          autoComplete="new-password"
          dir="ltr"
          maxLength={256}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={mode !== 'zip'}
          placeholder={device.hasArchivePassword ? (ar ? 'محفوظة — أدخل جديدة للتغيير' : 'Saved — enter a new one to change') : (ar ? 'اتركها فارغة بدون تشفير' : 'Leave empty for no encryption')}
          className="input mt-1.5 text-left"
        />
      </label>
    </div>
    <div className="mt-3 flex justify-end">
      <Button icon="save" loading={saving} onClick={() => void save()}>{ar ? 'حفظ الأرشفة' : 'Save archive'}</Button>
    </div>
  </section>;
}
