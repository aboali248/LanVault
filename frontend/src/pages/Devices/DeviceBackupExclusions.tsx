import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { DeviceFileTypeOverrides } from '../../components/FileTypeExclusions';
import { useApp } from '../../contexts/AppContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../services/api';
import type { Device } from '../../types';

export function DeviceBackupExclusions({ device }: { device: Device }) {
  const { language } = useApp();
  const { notify } = useToast();
  const [excluded, setExcluded] = useState(device.backupExcludedExtensions ?? []);
  const [included, setIncluded] = useState(device.backupIncludedExtensions ?? []);
  const [globalExcluded, setGlobalExcluded] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void api.getSettings()
      .then((settings) => { if (active) setGlobalExcluded(settings.backup.excludedExtensions ?? []); })
      .catch((error: unknown) => notify(
        error instanceof Error ? error.message : (language === 'ar' ? 'تعذر تحميل الاستثناءات العامة' : 'Could not load global exclusions'),
        'error',
      ));
    return () => { active = false; };
  }, [language, notify]);

  useEffect(() => {
    setExcluded(device.backupExcludedExtensions ?? []);
    setIncluded(device.backupIncludedExtensions ?? []);
  }, [device.id, device.backupExcludedExtensions, device.backupIncludedExtensions]);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.updateDeviceBackupExclusions(device.id, excluded, included);
      setExcluded(updated.backupExcludedExtensions);
      setIncluded(updated.backupIncludedExtensions);
      notify(language === 'ar' ? 'تم حفظ استثناءات الجهاز' : 'Device exclusions saved', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : (language === 'ar' ? 'تعذر حفظ الاستثناءات' : 'Could not save exclusions'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return <>
    <DeviceFileTypeOverrides
      language={language}
      globalExcludedExtensions={globalExcluded}
      excludedExtensions={excluded}
      includedExtensions={included}
      disabled={saving}
      onChange={(nextExcluded, nextIncluded) => { setExcluded(nextExcluded); setIncluded(nextIncluded); }}
    />
    <p className="text-xs text-slate-500 lg:col-span-2">
      {language === 'ar'
        ? 'ستُطبّق الاستثناءات العامة تلقائيًا. يمكنك اختيار «نسخ» لإلغاء استثناء عام لهذا الجهاز.'
        : 'Global exclusions apply automatically. Choose “Include” to override a global exclusion for this device.'}
    </p>
    <div className="flex justify-end lg:col-span-2">
      <Button type="button" icon="save" loading={saving} onClick={() => void save()}>
        {language === 'ar' ? 'حفظ استثناءات الجهاز' : 'Save device exclusions'}
      </Button>
    </div>
  </>;
}
