type SchedulerExerciseInput = {
  id: string;
  title: string;
  sets: number;
  reps: number;
  daysLabel: string;
  times: string[];
  remindersOn: boolean;
};

export type ScheduledOccurrence = {
  exerciseId: string;
  title: string;
  sets: number;
  reps: number;
  scheduledTime: Date;
  scheduleId: string;
};

const WEEKDAY_KEY_BY_LABEL: Record<string, 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'> = {
  mån: 'mon',
  man: 'mon',
  måndag: 'mon',
  mandag: 'mon',
  tis: 'tue',
  tisdag: 'tue',
  ons: 'wed',
  onsdag: 'wed',
  tor: 'thu',
  tors: 'thu',
  torsdag: 'thu',
  fre: 'fri',
  fredag: 'fri',
  lör: 'sat',
  lor: 'sat',
  lördag: 'sat',
  lordag: 'sat',
  sön: 'sun',
  son: 'sun',
  söndag: 'sun',
  sondag: 'sun',
};

const WEEKDAY_KEY_TO_JS_DAY: Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const ALL_JS_DAYS = [0, 1, 2, 3, 4, 5, 6];

function isEveryDayLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return normalized === 'varje dag' || normalized === 'alla dagar';
}

function parseDaysLabelToJsDays(daysLabel: string): number[] {
  if (isEveryDayLabel(daysLabel)) return ALL_JS_DAYS;
  return daysLabel
    .split(',')
    .map((label) => label.trim().toLowerCase())
    .map((label) => WEEKDAY_KEY_BY_LABEL[label])
    .filter((key): key is keyof typeof WEEKDAY_KEY_TO_JS_DAY => !!key)
    .map((key) => WEEKDAY_KEY_TO_JS_DAY[key]);
}

function parseTimeParts(rawTime: string): { hours: number; minutes: number; canonicalTime: string } | null {
  const [hoursRaw, minutesRaw] = rawTime.split(':');
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return {
    hours,
    minutes,
    canonicalTime: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
  };
}

function formatDateKeyLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function buildUpcomingScheduleOccurrences(
  exercises: SchedulerExerciseInput[],
  options?: { now?: Date; windowDays?: number },
): ScheduledOccurrence[] {
  const now = options?.now ?? new Date();
  const windowDays = Math.max(1, options?.windowDays ?? 30);
  const occurrences: ScheduledOccurrence[] = [];

  for (const exercise of exercises) {
    if (!exercise.remindersOn || exercise.times.length === 0) continue;

    const jsDays = parseDaysLabelToJsDays(exercise.daysLabel);
    if (jsDays.length === 0) continue;

    for (let dayOffset = 0; dayOffset < windowDays; dayOffset += 1) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
      if (!jsDays.includes(date.getDay())) continue;

      for (const rawTime of exercise.times) {
        const parsed = parseTimeParts(rawTime);
        if (!parsed) continue;

        const scheduledTime = new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          parsed.hours,
          parsed.minutes,
          0,
          0,
        );
        if (scheduledTime.getTime() <= now.getTime()) continue;

        occurrences.push({
          exerciseId: exercise.id,
          title: exercise.title,
          sets: exercise.sets,
          reps: exercise.reps,
          scheduledTime,
          scheduleId: `${exercise.id}-${parsed.canonicalTime}-${formatDateKeyLocal(scheduledTime)}`,
        });
      }
    }
  }

  occurrences.sort((a, b) => a.scheduledTime.getTime() - b.scheduledTime.getTime());
  return occurrences;
}
