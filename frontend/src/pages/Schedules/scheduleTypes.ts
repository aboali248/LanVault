import type { BackupSchedule } from '../../types';

export type ScheduleForm = Omit<BackupSchedule, 'id' | 'lastRunAt' | 'nextRunAt' | 'lastRun' | 'createdAt' | 'updatedAt'>;

export const blankForm: ScheduleForm = {
  name: '',
  targetType: 'device',
  targetId: '',
  frequency: 'daily',
  dayOfWeek: null,
  timeOfDay: '02:00',
  mode: 'incremental',
  retentionCount: null,
  enabled: true,
  windowStart: null,
  windowEnd: null,
  repeatIntervalMinutes: null,
};
