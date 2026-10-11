import { useState, type ReactNode } from 'react';
import type { Language } from '../types';
import { Select } from './Select';

export const FILE_EXTENSION_GROUPS = [
  {
    name: { ar: 'Outlook والبريد', en: 'Outlook and email' },
    extensions: ['.pst', '.ost', '.msg', '.eml', '.oft', '.olm', '.mbox', '.ics', '.vcf', '.contact'],
  },
  {
    name: { ar: 'الصوت', en: 'Audio' },
    extensions: ['.mp3', '.wav', '.aac', '.flac', '.ogg', '.wma', '.m4a', '.aiff', '.opus', '.amr', '.mid', '.midi'],
  },
  {
    name: { ar: 'الفيديو', en: 'Video' },
    extensions: ['.mp4', '.mkv', '.mov', '.avi', '.wmv', '.webm', '.flv', '.mpeg', '.mpg', '.m4v', '.3gp', '.mts', '.m2ts', '.vob'],
  },
  {
    name: { ar: 'الصور', en: 'Images' },
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff', '.webp', '.heic', '.raw', '.cr2', '.nef', '.psd', '.ai'],
  },
  {
    name: { ar: 'الملفات المضغوطة', en: 'Archives' },
    extensions: ['.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz', '.iso', '.tgz', '.zst', '.cab'],
  },
  {
    name: { ar: 'النسخ الاحتياطية وصور الأقراص', en: 'Backups and disk images' },
    extensions: ['.bak', '.backup', '.vhd', '.vhdx', '.vmdk', '.vdi', '.qcow2', '.ova', '.ovf', '.tib', '.wim'],
  },
  {
    name: { ar: 'المؤقتة والقديمة', en: 'Temporary and old files' },
    extensions: ['.tmp', '.temp', '.old', '.swp', '.part', '.cache', '.log', '.dmp', '.etl'],
  },
  {
    name: { ar: 'التطبيقات والتثبيت', en: 'Applications and installers' },
    extensions: ['.exe', '.msi', '.dll', '.sys', '.dmg', '.pkg', '.appx', '.msix', '.deb', '.rpm', '.apk'],
  },
  {
    name: { ar: 'المستندات والكتب الإلكترونية', en: 'Documents and ebooks' },
    extensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.epub', '.mobi', '.djvu'],
  },
] as const;

const knownExtensions = new Set<string>(FILE_EXTENSION_GROUPS.flatMap((group) => group.extensions));
const extensionPattern = /^\.[a-z0-9]+(?:\.[a-z0-9]+)*$/i;

function ExtensionGroups({ language, children, isSelected, renderActions }: {
  language: Language;
  children: (extension: string, label: string) => ReactNode;
  isSelected?: (extension: string) => boolean;
  renderActions?: (group: typeof FILE_EXTENSION_GROUPS[number]) => ReactNode;
}) {
  return <div className="mt-4 grid gap-3">
    {FILE_EXTENSION_GROUPS.map((group) => {
      const selectedCount = group.extensions.filter((extension) => isSelected?.(extension)).length;
      return <details key={group.name.en} className="group min-w-0 rounded-xl border border-slate-200/80 bg-white/70 dark:border-slate-700/80 dark:bg-slate-950/40">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-3 text-xs font-bold text-slate-700 outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-orange-500/50 dark:text-slate-200 dark:hover:bg-slate-900/70">
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className="truncate">{group.name[language]}</span>
            {isSelected && <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${selectedCount ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
              {selectedCount}/{group.extensions.length}
            </span>}
          </span>
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180">
            <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <div className="border-t border-slate-200/80 p-3 dark:border-slate-700/80">
          {renderActions?.(group)}
          <div className="grid grid-cols-2 gap-1.5">
            {group.extensions.map((extension) => children(extension, extension))}
          </div>
        </div>
      </details>;
    })}
  </div>;
}

function CustomExtensionInput({ language, onAdd, disabled = false }: {
  language: Language; onAdd: (extensions: string[]) => void; disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const add = () => {
    const entries = value.split(/[\s,;]+/).filter(Boolean).map((extension) =>
      (extension.startsWith('.') ? extension : `.${extension}`).toLocaleLowerCase());
    if (!entries.length) return;
    if (entries.some((extension) => extension.length > 32 || !extensionPattern.test(extension))) {
      setError(language === 'ar' ? 'أدخل امتدادات صحيحة مثل mp3 أو .tar.gz' : 'Enter valid extensions such as mp3 or .tar.gz');
      return;
    }
    setError('');
    onAdd([...new Set(entries)]);
    setValue('');
  };
  return <div className="mt-3">
    <div className="flex gap-2">
      <input disabled={disabled} className="input min-w-0 flex-1 text-xs" dir="ltr" value={value}
        onChange={(event) => { setValue(event.target.value); setError(''); }}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}
        placeholder={language === 'ar' ? 'امتدادات إضافية: .mp3, .tar.gz' : 'More extensions: .mp3, .tar.gz'} />
      <button type="button" disabled={disabled} onClick={add} className="rounded-lg border border-slate-300 px-3 text-xs font-semibold hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800">
        {language === 'ar' ? 'إضافة' : 'Add'}
      </button>
    </div>
    {error && <p role="alert" className="mt-1 text-xs text-rose-500">{error}</p>}
  </div>;
}

export function GlobalFileTypeExclusions({ language, excludedExtensions, onChange }: {
  language: Language;
  excludedExtensions: string[];
  onChange: (extensions: string[]) => void;
}) {
  const selected = new Set(excludedExtensions.map((extension) => extension.toLocaleLowerCase()));
  const custom = excludedExtensions.filter((extension) => !knownExtensions.has(extension.toLocaleLowerCase()));
  const toggle = (extension: string, checked: boolean) => {
    onChange([...new Set(checked
      ? [...selected, extension]
      : [...selected].filter((value) => value !== extension))].sort());
  };
  const setGroupSelected = (extensions: readonly string[], checked: boolean) => {
    const next = new Set(selected);
    for (const extension of extensions) {
      if (checked) next.add(extension);
      else next.delete(extension);
    }
    onChange([...next].sort());
  };
  const renderCheckbox = (extension: string, checked: boolean, onCheckedChange: (value: boolean) => void) => <label key={extension}
    className={`group flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors focus-within:ring-2 focus-within:ring-orange-500/50 ${
      checked
        ? 'border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-100'
        : 'border-transparent bg-slate-50 text-slate-600 hover:border-slate-200 hover:bg-slate-100 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800'
    }`}>
    <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} className="sr-only" />
    <span aria-hidden="true" className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
      checked
        ? 'border-orange-500 bg-orange-500 text-white shadow-sm shadow-orange-900/15'
        : 'border-slate-300 bg-white group-hover:border-orange-400 dark:border-slate-600 dark:bg-slate-950'
    }`}>
      {checked && <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3.25 8.25 3 3 6.5-6.5" />
      </svg>}
    </span>
    <span dir="ltr" className="min-w-0 truncate font-mono font-medium">{extension}</span>
  </label>;
  return <section className="mt-5 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-bold">{language === 'ar' ? 'استثناء صيغ الملفات - عام' : 'File type exclusions - global'}</h3>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">{language === 'ar'
          ? 'حدد الصيغ التي تريد تخطيها في جميع الأجهزة. يمكنك تخصيص الاستثناءات لكل جهاز من نافذة تفاصيل الجهاز.'
          : 'Choose file types to skip on every device. You can customize exclusions for individual devices in their details.'}</p>
      </div>
      <span className="inline-flex shrink-0 items-center rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700 dark:border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-300">
        {language === 'ar' ? `${selected.size} صيغة مستثناة` : `${selected.size} excluded`}
      </span>
    </header>
    <ExtensionGroups language={language} isSelected={(extension) => selected.has(extension)}
      renderActions={({ extensions }) => {
        const allSelected = extensions.every((extension) => selected.has(extension));
        return <div className="mb-3 flex justify-end">
          <button type="button" onClick={() => setGroupSelected(extensions, !allSelected)}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition-colors hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-orange-500/40 dark:hover:bg-orange-500/10 dark:hover:text-orange-300">
            {allSelected
              ? (language === 'ar' ? 'إلغاء تحديد الكل' : 'Clear all')
              : (language === 'ar' ? 'تحديد الكل' : 'Select all')}
          </button>
        </div>;
      }}>
      {(extension) => renderCheckbox(extension, selected.has(extension), (checked) => toggle(extension, checked))}
    </ExtensionGroups>
    <CustomExtensionInput language={language} onAdd={(extensions) => onChange([...new Set([...selected, ...extensions])].sort())} />
    {custom.length > 0 && <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">{custom.map((extension) =>
      renderCheckbox(extension, true, (checked) => toggle(extension, checked)))}</div>}
  </section>;
}

export function DeviceFileTypeOverrides({ language, globalExcludedExtensions, excludedExtensions, includedExtensions, onChange, disabled = false }: {
  language: Language;
  globalExcludedExtensions: string[];
  excludedExtensions: string[];
  includedExtensions: string[];
  onChange: (excluded: string[], included: string[]) => void;
  disabled?: boolean;
}) {
  const global = new Set(globalExcludedExtensions.map((extension) => extension.toLocaleLowerCase()));
  const localExcluded = new Set(excludedExtensions.map((extension) => extension.toLocaleLowerCase()));
  const localIncluded = new Set(includedExtensions.map((extension) => extension.toLocaleLowerCase()));
  const custom = [...new Set([...global, ...localExcluded, ...localIncluded])]
    .filter((extension) => !knownExtensions.has(extension))
    .sort();
  const setOverride = (extension: string, override: string) => {
    const nextExcluded = new Set(localExcluded);
    const nextIncluded = new Set(localIncluded);
    nextExcluded.delete(extension);
    nextIncluded.delete(extension);
    if (override === 'exclude') nextExcluded.add(extension);
    if (override === 'include') nextIncluded.add(extension);
    onChange([...nextExcluded].sort(), [...nextIncluded].sort());
  };
  const setGroupExcluded = (extensions: readonly string[], excluded: boolean) => {
    const nextExcluded = new Set(localExcluded);
    const nextIncluded = new Set(localIncluded);
    for (const extension of extensions) {
      nextExcluded.delete(extension);
      nextIncluded.delete(extension);
      if (excluded) nextExcluded.add(extension);
    }
    onChange([...nextExcluded].sort(), [...nextIncluded].sort());
  };
  const renderOverride = (extension: string) => <label key={extension} className="flex items-center justify-between gap-2 text-xs">
    <span dir="ltr" className="shrink-0">{extension}</span>
    <Select
      className="w-36 [&>button]:min-h-9 [&>button]:text-[11px]"
      value={localIncluded.has(extension) ? 'include' : localExcluded.has(extension) ? 'exclude' : 'inherit'}
      onValueChange={(value) => setOverride(extension, value)}
      disabled={disabled}
      options={[
        { value: 'inherit', label: language === 'ar' ? 'حسب العام' : 'Use global' },
        { value: 'exclude', label: language === 'ar' ? 'استثناء' : 'Exclude' },
        { value: 'include', label: language === 'ar' ? 'نسخ' : 'Include' },
      ]}
      ariaLabel={extension}
    />
  </label>;

  return <section className="min-w-0 rounded-xl border border-slate-200 p-4 dark:border-slate-700 lg:col-span-2">
    <h3 className="text-sm font-bold">{language === 'ar' ? 'استثناءات صيغ الملفات لهذا الجهاز' : 'File type overrides for this device'}</h3>
    <p className="mt-1 text-xs text-slate-500">{language === 'ar'
      ? 'يمكنك اتباع الإعداد العام، أو استثناء صيغة إضافية، أو نسخها حتى لو كانت مستثناة عامًا.'
      : 'Use the global setting, exclude an additional format, or include a format excluded globally.'}</p>
    <ExtensionGroups language={language} isSelected={(extension) => localExcluded.has(extension)}
      renderActions={({ extensions }) => {
        const allExcluded = extensions.every((extension) => localExcluded.has(extension));
        return <div className="mb-3 flex justify-end">
          <button type="button" disabled={disabled} onClick={() => setGroupExcluded(extensions, !allExcluded)}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition-colors hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-orange-500/40 dark:hover:bg-orange-500/10 dark:hover:text-orange-300">
            {allExcluded
              ? (language === 'ar' ? 'إعادة الكل للإعداد العام' : 'Reset all to global')
              : (language === 'ar' ? 'استثناء الكل' : 'Exclude all')}
          </button>
        </div>;
      }}>{(extension) => renderOverride(extension)}</ExtensionGroups>
    {custom.length > 0 && <div className="mt-3 grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2 dark:border-slate-700">{custom.map(renderOverride)}</div>}
    <CustomExtensionInput disabled={disabled} language={language} onAdd={(extensions) => {
      const nextExcluded = new Set(localExcluded);
      for (const extension of extensions) nextExcluded.add(extension);
      onChange([...nextExcluded].sort(), [...localIncluded].filter((extension) => !nextExcluded.has(extension)).sort());
    }} />
  </section>;
}
