import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { Select } from '../../components/Select';
import { useApp } from '../../contexts/AppContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../services/api';
import type { AppSettings } from '../../types';
import { AgentSettings } from './AgentSettings';
import { BackupSettings } from './BackupSettings';
import { ServerSettings } from './ServerSettings';

export function Settings() {
  const { t, language, setLanguage } = useApp();
  const { notify } = useToast();
  const [settings, setSettings] = useState<AppSettings>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const value = await api.getSettings();
      setSettings({ ...value, interface: { ...value.interface, language: value.interface?.language ?? language, theme: 'dark' } });
    } catch (error) { notify(error instanceof Error ? error.message : t('actionFailed'), 'error'); }
    finally { setLoading(false); }
  }, [language, notify, t]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await api.updateSettings(settings);
      setSettings(updated); setLanguage(updated.interface.language);
      notify(t('saveSuccess'), 'success');
    } catch (error) { notify(error instanceof Error ? error.message : t('actionFailed'), 'error'); }
    finally { setSaving(false); }
  };
  const updateSection = <K extends keyof AppSettings>(key: K, value: Partial<AppSettings[K]>) => {
    setSettings((current) => current ? { ...current, [key]: { ...current[key], ...value } } : current);
  };
  if (loading && !settings) return <><PageHeader icon="settings" title={t('settings')} description={t('systemConfiguration')} /><div className="surface p-5 text-sm text-slate-500">{t('loading')}</div></>;
  if (!settings) return <><PageHeader icon="settings" title={t('settings')} description={t('systemConfiguration')} /><div role="alert" className="surface p-5 text-sm text-rose-600"><Button variant="outline" onClick={() => void load()}>{t('retry')}</Button></div></>;
  return <>
    <PageHeader icon="settings" title={t('settings')} description={t('systemConfiguration')} actions={<Button icon="save" onClick={() => void save()} loading={saving}>{t('save')}</Button>} />
    <div className="space-y-5">
      <ServerSettings value={{ ...settings.server, ...settings.network }} />
      <BackupSettings value={settings.backup} onChange={(value) => updateSection('backup', value)} />
      <AgentSettings value={settings.agent} onChange={(value) => updateSection('agent', value)} />
      <section className="surface p-5"><h2 className="font-bold">{t('appearance')}</h2><div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="label">{t('language')}<Select className="mt-1.5" value={settings.interface.language} onValueChange={(value) => updateSection('interface', { language: value as AppSettings['interface']['language'] })} options={[{ value: 'ar', label: t('arabic') }, { value: 'en', label: t('english') }]} /></label>
      </div></section>
    </div>
  </>;
}
