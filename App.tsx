import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { DarkTheme as NavigationDarkTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
/* Custom slider replaces @react-native-community/slider for smoother Android performance */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GestureHandlerRootView, ScrollView, Swipeable } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import {
  Alert,
  Animated,
  AppState,
  BackHandler,
  Dimensions,
  Easing,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button, Checkbox, Dialog, FAB, MD3DarkTheme, Portal, Provider as PaperProvider } from 'react-native-paper';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

/* ── Notification handler (must be called at module level) ── */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type Exercise = {
  id: string;
  title: string;
  description: string;
  sets: number;
  reps: number;
  weightKg?: number;
  daysLabel: string;
  times: string[];
  remindersOn: boolean;
  color: string;
};

type ExerciseLog = { exerciseId: string; atIso: string };
type PainEntry = { id: string; atIso: string; value: number; note: string };
type PainSeries = { id: string; name: string; value: number; draftNote: string; entries: PainEntry[] };
type SessionSet = { id: string; reps: number; weightKg: number };
type SessionExercise = {
  id: string;
  name: string;
  sets: SessionSet[];
};
type WorkoutPlanExercise = { id: string; name: string; sets: number; reps: number };
type WorkoutPlan = { id: string; name: string; exercises: WorkoutPlanExercise[]; createdAtIso: string };
type CompletedWorkout = {
  id: string;
  startedAtIso: string;
  endedAtIso: string;
  durationSec: number;
  exercises: SessionExercise[];
  sourcePlanId?: string;
  sourcePlanName?: string;
};
type PersistedState = {
  exercises: Exercise[];
  logs: ExerciseLog[];
  painSeries: PainSeries[];
  workoutPlans?: WorkoutPlan[];
  completedWorkouts?: CompletedWorkout[];
  rehabLibraryExercises?: LibraryExercise[];
  gymLibraryExercises?: LibraryExercise[];
};
type DiaryViewMode = 'tim' | 'dag' | 'manad';
type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
type LibraryExercise = { id: string; name: string; tags: string[] };
type WizardMode = 'create' | 'edit';

const Tab = createBottomTabNavigator();
const DAY_WIDTH = 52;
const STORAGE_KEY = 'naphab_state_v1';
const SERIES_COLORS = [
  '#5E81AC', '#A3BE8C', '#EBCB8B', '#BF616A', '#B48EAD',
  '#88C0D0', '#D08770', '#81A1C1', '#8FBCBB', '#E5C07B',
];
const DAY_COLORS = ['#5E81AC', '#A3BE8C', '#EBCB8B', '#B48EAD', '#88C0D0', '#D08770', '#81A1C1'];
const PLACEHOLDER_COLOR = '#8FA1B3';
const ENTRY_SPACING = 70;
const CHART_SIDE_PADDING = 28;
const DIARY_VIEW_ORDER: DiaryViewMode[] = ['tim', 'dag', 'manad'];
const DIARY_VIEW_CONFIG: Record<DiaryViewMode, { label: string; spanMs: number }> = {
  tim: { label: 'Tim vy', spanMs: 24 * 60 * 60 * 1000 },
  dag: { label: 'Dags vy', spanMs: 7 * 24 * 60 * 60 * 1000 },
  manad: { label: 'Månads vy', spanMs: 28 * 24 * 60 * 60 * 1000 },
};
const SEED_START_DATE = new Date('2025-11-01T00:00:00.000Z');
const WEEKDAY_CHIPS: { key: WeekdayKey; label: string }[] = [
  { key: 'mon', label: 'Mån' },
  { key: 'tue', label: 'Tis' },
  { key: 'wed', label: 'Ons' },
  { key: 'thu', label: 'Tors' },
  { key: 'fri', label: 'Fre' },
  { key: 'sat', label: 'Lör' },
  { key: 'sun', label: 'Sön' },
];
const WEEKDAY_LABEL_BY_KEY: Record<WeekdayKey, string> = {
  mon: 'Mån',
  tue: 'Tis',
  wed: 'Ons',
  thu: 'Tors',
  fri: 'Fre',
  sat: 'Lör',
  sun: 'Sön',
};
const WEEKDAY_KEY_BY_LABEL: Record<string, WeekdayKey> = {
  mån: 'mon',
  tis: 'tue',
  ons: 'wed',
  tors: 'thu',
  fre: 'fri',
  lör: 'sat',
  sön: 'sun',
};

/* ── Notification constants & helpers ── */
const NOTIFICATION_CATEGORY_ID = 'exercise_reminder';
const SNOOZE_MINUTES = 10;
const NOTIFICATION_CHANNEL_ID = 'exercise-reminders';
const WEEKDAY_KEY_TO_JS_DAY: Record<WeekdayKey, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/** Parse the human-readable daysLabel back to JS day-of-week numbers (0 = Sun). */
function parseDaysLabelToJsDays(daysLabel: string): number[] {
  if (daysLabel === 'Varje dag') return [0, 1, 2, 3, 4, 5, 6];
  return daysLabel
    .split(',')
    .map((label) => label.trim().toLowerCase())
    .map((label) => WEEKDAY_KEY_BY_LABEL[label])
    .filter((key): key is WeekdayKey => !!key)
    .map((key) => WEEKDAY_KEY_TO_JS_DAY[key]);
}

/**
 * Returns true if the exercise was logged within 1 hour BEFORE the scheduled time.
 * This prevents sending a notification when the user already marked the exercise as done.
 */
function wasExerciseLoggedNearTime(
  exerciseId: string,
  scheduledTime: Date,
  logs: ExerciseLog[],
): boolean {
  const oneHourBeforeMs = scheduledTime.getTime() - 60 * 60 * 1000;
  const scheduledMs = scheduledTime.getTime();
  return logs.some((log) => {
    if (log.exerciseId !== exerciseId) return false;
    const logMs = new Date(log.atIso).getTime();
    return logMs >= oneHourBeforeMs && logMs <= scheduledMs;
  });
}

/**
 * Cancel all previously scheduled notifications and re-schedule for the next 7 days
 * based on current exercises and logs.
 */
async function scheduleExerciseNotifications(
  exercises: Exercise[],
  logs: ExerciseLog[],
): Promise<void> {
  // Cancel everything so we start fresh
  await Notifications.cancelAllScheduledNotificationsAsync();

  if (!Device.isDevice) return; // Notifications require a physical device

  // Ensure Android notification channel exists
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
      name: 'Övningspåminnelser',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
    });
  }

  const now = new Date();

  for (const exercise of exercises) {
    if (!exercise.remindersOn || exercise.times.length === 0) continue;

    const jsDays = parseDaysLabelToJsDays(exercise.daysLabel);
    if (jsDays.length === 0) continue;

    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
      if (!jsDays.includes(date.getDay())) continue;

      for (const timeStr of exercise.times) {
        const parts = timeStr.split(':');
        const hours = Number(parts[0]);
        const minutes = Number(parts[1]);
        if (!Number.isFinite(hours) || !Number.isFinite(minutes)) continue;

        const scheduledTime = new Date(
          date.getFullYear(), date.getMonth(), date.getDate(),
          hours, minutes, 0, 0,
        );

        // Skip times in the past
        if (scheduledTime.getTime() <= now.getTime()) continue;

        // Skip if user already logged this exercise within 1 h before the slot
        if (wasExerciseLoggedNearTime(exercise.id, scheduledTime, logs)) continue;

        try {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: 'Dags för övning!',
              body: `${exercise.title} – ${exercise.sets} set × ${exercise.reps} reps`,
              categoryIdentifier: NOTIFICATION_CATEGORY_ID,
              data: {
                exerciseId: exercise.id,
                exerciseTitle: exercise.title,
                exerciseSets: exercise.sets,
                exerciseReps: exercise.reps,
                scheduledTimeIso: scheduledTime.toISOString(),
              },
              sound: true,
              ...(Platform.OS === 'android' ? { channelId: NOTIFICATION_CHANNEL_ID } : {}),
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: scheduledTime,
            },
          });
        } catch {
          // Skip individual scheduling failures silently
        }
      }
    }
  }
}

const LIBRARY_EXERCISES: LibraryExercise[] = [
  { id: 'jefferson-curls', name: 'Jefferson curls', tags: ['Rygg', 'Baksida lår'] },
  { id: 'snoanglar', name: 'Snöänglar', tags: ['Axlar', 'Bröstrygg'] },
  { id: 'nervmobilisering-ischias', name: 'Nervmobilisering ischias', tags: ['Nerver', 'Ben'] },
  { id: 'nervmobilisering-brachialis', name: 'Nervmobilisering brachialis', tags: ['Nerver', 'Armar'] },
  { id: 'utfallsteg', name: 'Utfallsteg', tags: ['Ben'] },
  { id: 'enbensknaboj', name: 'Enbensknäböj', tags: ['Ben', 'Balans'] },
  { id: 'static-neckhold', name: 'Static neckhold', tags: ['Nacke'] },
  { id: 'sittande-knaspark', name: 'Sittande knäspark', tags: ['Ben'] },
  { id: 'rotation-nacke', name: 'Rotation nacke', tags: ['Nacke'] },
  { id: 'boj-nacke', name: 'Böj nacke', tags: ['Nacke'] },
  { id: 'boj-strack-brostrygg', name: 'Sittande böj/sträck bröstrygg', tags: ['Bröstrygg'] },
];
const GYM_LIBRARY_EXERCISES: LibraryExercise[] = [
  { id: 'bench-press', name: 'Bänkpress', tags: ['Bröst', 'Triceps'] },
  { id: 'squat', name: 'Knäböj', tags: ['Ben'] },
  { id: 'deadlift', name: 'Marklyft', tags: ['Rygg', 'Ben'] },
  { id: 'overhead-press', name: 'Militärpress', tags: ['Axlar', 'Triceps'] },
  { id: 'barbell-row', name: 'Skivstångsrodd', tags: ['Rygg', 'Biceps'] },
  { id: 'lat-pulldown', name: 'Latsdrag', tags: ['Rygg', 'Biceps'] },
  { id: 'leg-press', name: 'Benpress', tags: ['Ben'] },
  { id: 'romanian-deadlift', name: 'Raka marklyft', tags: ['Baksida lår', 'Rygg'] },
  { id: 'incline-dumbbell-press', name: 'Lutande hantelpress', tags: ['Bröst', 'Axlar'] },
  { id: 'bicep-curl', name: 'Bicepscurl', tags: ['Biceps'] },
  { id: 'tricep-pushdown', name: 'Triceps pushdown', tags: ['Triceps'] },
  { id: 'hip-thrust', name: 'Hip thrust', tags: ['Säte', 'Ben'] },
];

const swedishWeekday = (date: Date) =>
  new Intl.DateTimeFormat('sv-SE', { weekday: 'short' }).format(date).replace('.', '');
const formatDateKey = (date: Date) => date.toISOString().slice(0, 10);
const shortDate = (date: Date) =>
  `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
const shortTime = (date: Date) =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
const mixHexWithBase = (hex: string, blend: number) => {
  const cleaned = hex.replace('#', '');
  const base = { r: 26, g: 37, b: 49 };
  if (cleaned.length !== 6) return `rgb(${base.r}, ${base.g}, ${base.b})`;
  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  const mix = Math.max(0, Math.min(1, blend));
  const mixedR = Math.round(base.r + (r - base.r) * mix);
  const mixedG = Math.round(base.g + (g - base.g) * mix);
  const mixedB = Math.round(base.b + (b - base.b) * mix);
  return `rgb(${mixedR}, ${mixedG}, ${mixedB})`;
};
const parseClock = (value: string) => {
  const [hoursRaw, minutesRaw] = value.split(':');
  const parsed = new Date();
  const h = Number(hoursRaw);
  const m = Number(minutesRaw);
  parsed.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0);
  return parsed;
};
const normalizeCategoryTag = (value: string) => value.trim().replace(/\s+/g, ' ');
const monthTitle = (date: Date) =>
  `${date.getFullYear()} ${new Intl.DateTimeFormat('sv-SE', { month: 'long' }).format(date)}`;

const buildTimelineDays = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days: Date[] = [];
  for (let i = -60; i <= 7; i += 1) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  return days;
};

const createCurvePath = (points: { x: number; y: number }[]) => {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const x = points[0].x;
    const y = points[0].y;
    return `M ${x - 12} ${y} L ${x + 12} ${y}`;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const cp1x = prev.x + (curr.x - prev.x) / 2;
    const cp1y = prev.y;
    const cp2x = prev.x + (curr.x - prev.x) / 2;
    const cp2y = curr.y;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${curr.x} ${curr.y}`;
  }
  return d;
};

const buildSeedPainEntries = (tag: string, baseValue: number): PainEntry[] => {
  const entries: PainEntry[] = [];
  const now = new Date();
  const start = new Date(SEED_START_DATE);
  const totalDays = Math.max(0, Math.floor((now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
  for (let i = totalDays; i >= 0; i -= 1) {
    const morning = new Date(now);
    morning.setDate(now.getDate() - i);
    morning.setHours(8, 30, 0, 0);
    const dayKey = formatDateKey(morning);
    const morningValue = Math.max(1, Math.min(10, baseValue + ((i % 5) - 2)));
    entries.push({
      id: `${tag}-m-${dayKey}`,
      atIso: morning.toISOString(),
      value: morningValue,
      note: i % 3 === 0 ? 'Kändes bättre efter promenad.' : '',
    });

    if (i % 2 === 0) {
      const evening = new Date(now);
      evening.setDate(now.getDate() - i);
      evening.setHours(19, 15, 0, 0);
      const eveningValue = Math.max(1, Math.min(10, baseValue + 1 - (i % 3)));
      entries.push({
        id: `${tag}-e-${dayKey}`,
        atIso: evening.toISOString(),
        value: eveningValue,
        note: i % 8 === 0 ? 'Mer stel på kvällen.' : '',
      });
    }
  }
  return entries;
};

const mergeEntriesWithSeed = (currentEntries: PainEntry[], tag: string, baseValue: number): PainEntry[] => {
  const mergedById = new Map<string, PainEntry>();
  const byTimestamp = [...currentEntries].sort(
    (a, b) => new Date(a.atIso).getTime() - new Date(b.atIso).getTime(),
  );
  byTimestamp.forEach((entry) => mergedById.set(entry.id, entry));
  buildSeedPainEntries(tag, baseValue).forEach((entry) => {
    if (!mergedById.has(entry.id)) {
      mergedById.set(entry.id, entry);
    }
  });
  return [...mergedById.values()].sort(
    (a, b) => new Date(a.atIso).getTime() - new Date(b.atIso).getTime(),
  );
};

function HomeScreen({
  exercises,
  setExercises,
  onQuickLog,
  onAddExercise,
  onEditExercise,
  onDeleteExercise,
}: {
  exercises: Exercise[];
  setExercises: React.Dispatch<React.SetStateAction<Exercise[]>>;
  onQuickLog: (exerciseId: string) => void;
  onAddExercise: () => void;
  onEditExercise: (exercise: Exercise) => void;
  onDeleteExercise: (exercise: Exercise) => void;
}) {

  const updateExercise = (id: string, patch: Partial<Exercise>) =>
    setExercises((prev) => prev.map((exercise) => (exercise.id === id ? { ...exercise, ...patch } : exercise)));

  return (
    <View style={styles.screen}>
      {exercises.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Inga övningar ännu</Text>
          <Text style={styles.emptySubtitle}>Tryck på ＋ för att lägga till din första övning</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent}>
          {exercises.map((exercise) => (
            <Swipeable
              key={exercise.id}
              overshootLeft={false}
              overshootRight={false}
              renderLeftActions={() => (
                <View style={[styles.swipeActions, styles.swipeActionsLeft]}>
                  <Pressable style={[styles.swipeButton, styles.editButton]} onPress={() => onEditExercise(exercise)}>
                    <MaterialIcons name="edit" size={22} color="#fff" />
                    <Text style={styles.swipeButtonText}>Redigera</Text>
                  </Pressable>
                </View>
              )}
              renderRightActions={() => (
                <View style={[styles.swipeActions, styles.swipeActionsRight]}>
                  <Pressable style={[styles.swipeButton, styles.deleteButton]} onPress={() => onDeleteExercise(exercise)}>
                    <MaterialIcons name="delete" size={22} color="#fff" />
                    <Text style={styles.swipeButtonText}>Ta bort</Text>
                  </Pressable>
                </View>
              )}
            >
              <Pressable
                onLongPress={() => Alert.alert(exercise.title, exercise.description)}
                style={[
                  styles.exerciseCard,
                  { borderLeftColor: exercise.color, backgroundColor: mixHexWithBase(exercise.color, 0.28) },
                ]}
              >
                <View style={styles.exerciseMain}>
                  <Text style={styles.exerciseTitle}>{exercise.title}</Text>
                  <Text style={styles.exerciseMeta}>
                    Dos: {exercise.sets}×{exercise.reps}
                    {exercise.weightKg ? ` + ${exercise.weightKg} kg` : ''}
                  </Text>
                  <Text style={styles.exerciseMeta}>Dagar: {exercise.daysLabel}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.timeRow}>
                    <Text style={styles.exerciseMeta}>Tider: {exercise.times.join(' · ')}</Text>
                  </ScrollView>
                </View>
                <View style={styles.exerciseRight}>
                  <Text style={styles.reminderLabel}>Påminnelser:</Text>
                  <Switch
                    value={exercise.remindersOn}
                    onValueChange={(value) => updateExercise(exercise.id, { remindersOn: value })}
                  />
                  <Pressable
                    onPress={() =>
                      Alert.alert(
                        'Logga övning',
                        'Vill du registrera att du gjort övningen?',
                        [
                          { text: 'Avbryt', style: 'cancel' },
                          { text: 'Registrera', onPress: () => onQuickLog(exercise.id) },
                        ],
                      )
                    }
                    style={styles.weightButton}
                  >
                    <MaterialCommunityIcons name="dumbbell" size={24} color="#2E7D32" />
                  </Pressable>
                </View>
              </Pressable>
            </Swipeable>
          ))}
        </ScrollView>
      )}

      <FAB
        icon="plus"
        color="#000"
        style={[styles.fab, { backgroundColor: '#A5D6A7' }]}
        onPress={onAddExercise}
      />
    </View>
  );
}

function TrainingScreen({
  workoutPlans,
  setWorkoutPlans,
  completedWorkouts,
  setCompletedWorkouts,
  gymLibraryExercises,
  setGymLibraryExercises,
}: {
  workoutPlans: WorkoutPlan[];
  setWorkoutPlans: React.Dispatch<React.SetStateAction<WorkoutPlan[]>>;
  completedWorkouts: CompletedWorkout[];
  setCompletedWorkouts: React.Dispatch<React.SetStateAction<CompletedWorkout[]>>;
  gymLibraryExercises: LibraryExercise[];
  setGymLibraryExercises: React.Dispatch<React.SetStateAction<LibraryExercise[]>>;
}) {
  const gymSheetMaxDrag = Math.round(Dimensions.get('window').height * 0.92);
  const [view, setView] = useState<'home' | 'session' | 'builder' | 'saved' | 'historyDetail'>('home');
  const [libraryMode, setLibraryMode] = useState<'session' | 'builder' | null>(null);
  const [sessionStartedAtIso, setSessionStartedAtIso] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [sessionExercises, setSessionExercises] = useState<SessionExercise[]>([]);
  const [sessionSourcePlanId, setSessionSourcePlanId] = useState<string | null>(null);
  const [sessionSourcePlanName, setSessionSourcePlanName] = useState<string | null>(null);
  const [builderName, setBuilderName] = useState('');
  const [builderExercises, setBuilderExercises] = useState<WorkoutPlanExercise[]>([]);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [historySelectionMode, setHistorySelectionMode] = useState(false);
  const [selectedHistoryWorkoutIds, setSelectedHistoryWorkoutIds] = useState<string[]>([]);
  const [selectedHistoryWorkout, setSelectedHistoryWorkout] = useState<CompletedWorkout | null>(null);
  const [gymCategoryEditorVisible, setGymCategoryEditorVisible] = useState(false);
  const [gymCategoryEditorExerciseId, setGymCategoryEditorExerciseId] = useState<string | null>(null);
  const [gymCategoryDraftTags, setGymCategoryDraftTags] = useState<string[]>([]);
  const [gymCategoryCustomInput, setGymCategoryCustomInput] = useState('');
  const [gymLibraryVisible, setGymLibraryVisible] = useState(false);
  const [gymLibraryQuery, setGymLibraryQuery] = useState('');
  const [gymLibraryFilter, setGymLibraryFilter] = useState<string | null>(null);
  const [gymSheetExpanded, setGymSheetExpanded] = useState(false);
  const gymSheetTranslateY = useRef(new Animated.Value(150)).current;
  const gymSheetStartY = useRef(150);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!sessionStartedAtIso) return;
    const tick = () => {
      const start = new Date(sessionStartedAtIso).getTime();
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sessionStartedAtIso]);

  useEffect(() => {
    if (!sessionStartedAtIso || view === 'session') {
      pulseAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.94, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [sessionStartedAtIso, view, pulseAnim]);

  const formatDuration = (totalSec: number) => {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0
      ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const openLibrary = (mode: 'session' | 'builder') => {
    setLibraryMode(mode);
    setGymSheetExpanded(true);
    gymSheetTranslateY.setValue(0);
    setGymLibraryVisible(true);
  };

  const addLibraryExercise = (exercise: LibraryExercise) => {
    if (!libraryMode) return;
    if (libraryMode === 'session') {
      setSessionExercises((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, name: exercise.name, sets: [] }]);
    } else {
      setBuilderExercises((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, name: exercise.name, sets: 3, reps: 10 }]);
    }
    setGymLibraryVisible(false);
    setLibraryMode(null);
  };
  const filteredGymLibrary = useMemo(() => {
    const query = gymLibraryQuery.trim().toLowerCase();
    return gymLibraryExercises.filter((exercise) => {
      const matchesQuery =
        query.length === 0 ||
        exercise.name.toLowerCase().includes(query) ||
        exercise.tags.some((tag) => tag.toLowerCase().includes(query));
      const matchesFilter = !gymLibraryFilter || exercise.tags.includes(gymLibraryFilter);
      return matchesQuery && matchesFilter;
    });
  }, [gymLibraryExercises, gymLibraryFilter, gymLibraryQuery]);
  const gymBodyPartFilters = useMemo(
    () => [...new Set(gymLibraryExercises.flatMap((exercise) => exercise.tags))],
    [gymLibraryExercises],
  );
  const gymCategoryChoices = useMemo(() => {
    const combined = [...gymBodyPartFilters, ...gymCategoryDraftTags];
    return [...new Set(combined)].sort((a, b) => a.localeCompare(b, 'sv-SE'));
  }, [gymBodyPartFilters, gymCategoryDraftTags]);
  const hasExactGymMatch = useMemo(() => {
    const query = gymLibraryQuery.trim().toLowerCase();
    if (query.length === 0) return true;
    return gymLibraryExercises.some((exercise) => exercise.name.toLowerCase() === query);
  }, [gymLibraryExercises, gymLibraryQuery]);
  const addCustomGymExercise = () => {
    const name = gymLibraryQuery.trim();
    if (!name) return;
    const alreadyExists = gymLibraryExercises.some((exercise) => exercise.name.toLowerCase() === name.toLowerCase());
    const nextExercise = alreadyExists
      ? gymLibraryExercises.find((exercise) => exercise.name.toLowerCase() === name.toLowerCase()) || null
      : { id: `gym-custom-${Date.now()}`, name, tags: ['Egen'] };
    if (!alreadyExists && nextExercise) {
      setGymLibraryExercises((prev) => [nextExercise, ...prev]);
    }
    if (nextExercise) {
      addLibraryExercise(nextExercise);
      setGymLibraryQuery('');
      setGymLibraryFilter(null);
    }
  };
  const openGymCategoryEditor = (exercise: LibraryExercise) => {
    setGymCategoryEditorExerciseId(exercise.id);
    setGymCategoryDraftTags(exercise.tags);
    setGymCategoryCustomInput('');
    setGymCategoryEditorVisible(true);
  };
  const closeGymCategoryEditor = () => {
    setGymCategoryEditorVisible(false);
  };
  const toggleGymCategoryDraft = (tag: string) => {
    setGymCategoryDraftTags((prev) => (prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]));
  };
  const addGymCustomCategory = () => {
    const next = normalizeCategoryTag(gymCategoryCustomInput);
    if (!next) return;
    setGymCategoryDraftTags((prev) => (prev.includes(next) ? prev : [...prev, next]));
    setGymCategoryCustomInput('');
  };
  const saveGymCategoryEditor = () => {
    if (!gymCategoryEditorExerciseId) return;
    const cleanedTags = [...new Set(gymCategoryDraftTags.map((tag) => normalizeCategoryTag(tag)).filter(Boolean))];
    if (cleanedTags.length === 0) {
      Alert.alert('Välj kategori', 'Lägg till minst en kategori för övningen.');
      return;
    }
    setGymLibraryExercises((prev) =>
      prev.map((exercise) => (exercise.id === gymCategoryEditorExerciseId ? { ...exercise, tags: cleanedTags } : exercise)),
    );
    setGymCategoryEditorVisible(false);
    setGymCategoryEditorExerciseId(null);
    setGymCategoryCustomInput('');
  };

  const sessionAddSet = (exerciseId: string) =>
    setSessionExercises((prev) =>
      prev.map((exercise) => {
        if (exercise.id !== exerciseId) return exercise;
        const last = exercise.sets[exercise.sets.length - 1];
        return {
          ...exercise,
          sets: [
            ...exercise.sets,
            {
              id: `${Date.now()}-${Math.random()}`,
              reps: last?.reps ?? 10,
              weightKg: last?.weightKg ?? 40,
            },
          ],
        };
      }),
    );

  const sessionAdjustSet = (exerciseId: string, setId: string, field: 'reps' | 'weightKg', delta: number) =>
    setSessionExercises((prev) =>
      prev.map((exercise) =>
        exercise.id !== exerciseId
          ? exercise
          : {
              ...exercise,
              sets: exercise.sets.map((setEntry) => {
                if (setEntry.id !== setId) return setEntry;
                if (field === 'reps') return { ...setEntry, reps: Math.max(1, Math.min(50, setEntry.reps + delta)) };
                const next = Math.round((setEntry.weightKg + delta) * 2) / 2;
                return { ...setEntry, weightKg: Math.max(0, Math.min(400, next)) };
              }),
            },
      ),
    );

  const startWorkout = () => {
    setSessionExercises([]);
    setSessionSourcePlanId(null);
    setSessionSourcePlanName(null);
    setSessionStartedAtIso(new Date().toISOString());
    setElapsedSeconds(0);
    setView('session');
  };
  const hasLoggedSessionContent = useMemo(
    () => sessionExercises.some((exercise) => exercise.sets.length > 0),
    [sessionExercises],
  );
  const endSessionWithoutSaving = () => {
    setSessionExercises([]);
    setSessionSourcePlanId(null);
    setSessionSourcePlanName(null);
    setSessionStartedAtIso(null);
    setElapsedSeconds(0);
    setView('home');
  };

  const buildSessionExercisesFromPlan = (plan: WorkoutPlan): SessionExercise[] =>
    plan.exercises.map((exercise) => ({
      id: `${Date.now()}-${Math.random()}`,
      name: exercise.name,
      sets: Array.from({ length: exercise.sets }, () => ({
        id: `${Date.now()}-${Math.random()}`,
        reps: exercise.reps,
        weightKg: 0,
      })),
    }));

  const startWorkoutFromPlan = (plan: WorkoutPlan) => {
    setSessionExercises(buildSessionExercisesFromPlan(plan));
    setSessionSourcePlanId(plan.id);
    setSessionSourcePlanName(plan.name);
    setSessionStartedAtIso(new Date().toISOString());
    setElapsedSeconds(0);
    setView('session');
  };

  const loadPlanForEditing = (plan: WorkoutPlan) => {
    setEditingPlanId(plan.id);
    setBuilderName(plan.name);
    setBuilderExercises(plan.exercises.map((exercise) => ({ ...exercise })));
    setView('builder');
  };

  const commitCompletedWorkout = () => {
    if (!sessionStartedAtIso) return;
    if (!hasLoggedSessionContent) {
      Alert.alert('Inget att spara', 'Lägg till minst en övning med minst ett set innan du sparar passet.');
      return;
    }
    const endedAtIso = new Date().toISOString();
    const durationSec = Math.max(0, Math.floor((new Date(endedAtIso).getTime() - new Date(sessionStartedAtIso).getTime()) / 1000));
    setCompletedWorkouts((prev) => [
      {
        id: `${Date.now()}`,
        startedAtIso: sessionStartedAtIso,
        endedAtIso,
        durationSec,
        exercises: sessionExercises,
        sourcePlanId: sessionSourcePlanId ?? undefined,
        sourcePlanName: sessionSourcePlanName ?? undefined,
      },
      ...prev,
    ]);
    endSessionWithoutSaving();
  };
  const saveCompletedWorkout = () => {
    if (!hasLoggedSessionContent) {
      endSessionWithoutSaving();
      return;
    }
    Alert.alert(
      'Avsluta pass?',
      'Vill du avsluta och spara ditt pass?',
      [
        { text: 'Avbryt', style: 'cancel' },
        { text: 'Spara pass', onPress: commitCompletedWorkout },
      ],
    );
  };

  const resolveWorkoutDisplay = (workout: CompletedWorkout) => {
    const startedDate = new Date(workout.startedAtIso);
    const dateLabel = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(startedDate);
    const timeLabel = new Intl.DateTimeFormat('sv-SE', { timeStyle: 'short' }).format(startedDate);
    if (workout.sourcePlanName) {
      return {
        name: workout.sourcePlanName,
        dateTimeLabel: `${dateLabel} kl ${timeLabel}`,
        durationLabel: `Tid: ${formatDuration(workout.durationSec)}`,
      };
    }

    const categorySet = new Set<string>();
    workout.exercises.forEach((exercise) => {
      const match = gymLibraryExercises.find((libraryExercise) => libraryExercise.name.toLowerCase() === exercise.name.toLowerCase());
      if (match) {
        match.tags.forEach((tag) => categorySet.add(tag));
      } else {
        categorySet.add(exercise.name);
      }
    });

    const categories = [...categorySet];
    return {
      name: categories.join(', '),
      dateTimeLabel: `${dateLabel} kl ${timeLabel}`,
      durationLabel: `Tid: ${formatDuration(workout.durationSec)}`,
    };
  };
  const activateHistorySelection = (workoutId: string) => {
    setHistorySelectionMode(true);
    setSelectedHistoryWorkoutIds((prev) => (prev.includes(workoutId) ? prev : [...prev, workoutId]));
  };
  const toggleHistorySelection = (workoutId: string) => {
    setSelectedHistoryWorkoutIds((prev) => {
      const next = prev.includes(workoutId) ? prev.filter((id) => id !== workoutId) : [...prev, workoutId];
      if (next.length === 0) setHistorySelectionMode(false);
      return next;
    });
  };
  const deleteSelectedHistoryWorkouts = () => {
    if (selectedHistoryWorkoutIds.length === 0) return;
    setCompletedWorkouts((prev) => prev.filter((item) => !selectedHistoryWorkoutIds.includes(item.id)));
    setSelectedHistoryWorkoutIds([]);
    setHistorySelectionMode(false);
  };
  const openHistoryWorkout = (workout: CompletedWorkout) => {
    setSelectedHistoryWorkout(workout);
    setView('historyDetail');
  };

  const animateGymSheet = (expanded: boolean) => {
    setGymSheetExpanded(expanded);
    Animated.spring(gymSheetTranslateY, {
      toValue: expanded ? 0 : 150,
      useNativeDriver: true,
      damping: 18,
      stiffness: 180,
      mass: 0.5,
    }).start();
  };
  const closeGymLibrary = useCallback(() => {
    Animated.timing(gymSheetTranslateY, {
      toValue: gymSheetMaxDrag,
      duration: 250,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setGymLibraryVisible(false);
      setLibraryMode(null);
      setGymSheetExpanded(false);
    });
  }, [gymSheetMaxDrag, gymSheetTranslateY]);
  useEffect(() => {
    const onBackPress = () => {
      if (view === 'home') return false;
      if (gymLibraryVisible) {
        closeGymLibrary();
      } else {
        setView('home');
      }
      return true;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [closeGymLibrary, gymLibraryVisible, view]);
  const gymSheetCloseThreshold = Math.round(gymSheetMaxDrag * 0.25);
  const gymSheetPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 6,
      onMoveShouldSetPanResponderCapture: (_, gesture) => gesture.dy > 6,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        gymSheetTranslateY.stopAnimation((value) => {
          gymSheetStartY.current = value;
        });
      },
      onPanResponderMove: (_, gesture) => {
        const next = Math.max(0, Math.min(gymSheetMaxDrag, gymSheetStartY.current + gesture.dy));
        gymSheetTranslateY.setValue(next);
      },
      onPanResponderRelease: (_, gesture) => {
        const releaseY = Math.max(0, Math.min(gymSheetMaxDrag, gymSheetStartY.current + gesture.dy));
        if (releaseY > gymSheetCloseThreshold) {
          closeGymLibrary();
          return;
        }
        Animated.timing(gymSheetTranslateY, {
          toValue: 0,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  const saveBuilderPlan = () => {
    if (builderExercises.length === 0) {
      Alert.alert('Inget att spara', 'Lägg till minst en övning innan du sparar passet.');
      return;
    }
    const name = builderName.trim() || `Pass ${new Intl.DateTimeFormat('sv-SE', { day: '2-digit', month: '2-digit' }).format(new Date())}`;
    setWorkoutPlans((prev) => {
      if (editingPlanId) {
        return prev.map((plan) =>
          plan.id === editingPlanId ? { ...plan, name, exercises: builderExercises.map((exercise) => ({ ...exercise })) } : plan,
        );
      }
      return [
        { id: `${Date.now()}`, name, exercises: builderExercises.map((exercise) => ({ ...exercise })), createdAtIso: new Date().toISOString() },
        ...prev,
      ];
    });
    setBuilderName('');
    setBuilderExercises([]);
    setEditingPlanId(null);
    setView('home');
  };

  return (
    <View style={styles.screen}>
      {view === 'home' ? (
        <ScrollView contentContainerStyle={styles.listContent}>
          {sessionStartedAtIso ? (
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <Pressable style={[styles.trainingPrimaryAction, styles.ongoingWorkoutButton]} onPress={() => setView('session')}>
                <Text style={styles.trainingPrimaryTitle}>Fortsätt pågående pass</Text>
                <Text style={styles.ongoingWorkoutText}>Tid: {formatDuration(elapsedSeconds)}</Text>
              </Pressable>
            </Animated.View>
          ) : (
            <Pressable style={styles.trainingPrimaryAction} onPress={startWorkout}>
              <Text style={styles.trainingPrimaryTitle}>Starta träning</Text>
              <Text style={styles.trainingPrimarySubtitle}>Starta nytt pass från scratch</Text>
            </Pressable>
          )}
          <View style={styles.trainingHomeButtonsRow}>
            <Button mode="outlined" style={styles.trainingHomeButton} contentStyle={styles.trainingHomeButtonContent} onPress={() => { setBuilderName(''); setBuilderExercises([]); setEditingPlanId(null); setView('builder'); }}>
              Skapa pass
            </Button>
            <Button mode="outlined" style={styles.trainingHomeButton} contentStyle={styles.trainingHomeButtonContent} onPress={() => setView('saved')}>
              Mina pass
            </Button>
          </View>
          <View style={styles.historyHeaderRow}>
            <Text style={styles.trainingSectionTitle}>Historik</Text>
            {historySelectionMode ? (
              <View style={styles.historySelectionActions}>
                <Text style={styles.historySelectedCount}>{selectedHistoryWorkoutIds.length}</Text>
                <Pressable style={styles.historyTrashButton} onPress={deleteSelectedHistoryWorkouts}>
                  <MaterialIcons name="delete" size={22} color="#0F1419" />
                </Pressable>
              </View>
            ) : null}
          </View>
          {completedWorkouts.length === 0 ? <Text style={styles.loggedSetEmpty}>Inga sparade pass ännu.</Text> : null}
          {completedWorkouts.map((workout) => (
            <Pressable
              key={workout.id}
              style={[styles.trainingCard, selectedHistoryWorkoutIds.includes(workout.id) && styles.historySelectedCard]}
              onLongPress={() => activateHistorySelection(workout.id)}
              onPress={() => {
                if (historySelectionMode) {
                  toggleHistorySelection(workout.id);
                  return;
                }
                openHistoryWorkout(workout);
              }}
            >
              {(() => {
                const workoutDisplay = resolveWorkoutDisplay(workout);
                return (
                  <View style={styles.historyCardContent}>
                    <Text style={styles.historyCardTitle}>{workoutDisplay.name}</Text>
                    <Text style={styles.historyCardDateTime}>{workoutDisplay.dateTimeLabel}</Text>
                    <Text style={styles.historyCardDuration}>{workoutDisplay.durationLabel}</Text>
                  </View>
                );
              })()}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {view === 'session' ? (
        <View style={styles.screen}>
          <View style={styles.trainingSessionTop}>
            <Text style={styles.trainingTimer}>{formatDuration(elapsedSeconds)}</Text>
          </View>
          <ScrollView contentContainerStyle={styles.listContent}>
            {sessionExercises.length === 0 ? <Text style={styles.loggedSetEmpty}>Inga övningar än. Tryck på ＋.</Text> : null}
            {sessionExercises.map((exercise) => (
              <View key={exercise.id} style={styles.trainingCard}>
                <View style={styles.trainingHeader}>
                  <Text style={styles.trainingTitle}>{exercise.name}</Text>
                  <Pressable onPress={() => setSessionExercises((prev) => prev.filter((item) => item.id !== exercise.id))}>
                    <MaterialIcons name="delete" size={22} color="#EF9A9A" />
                  </Pressable>
                </View>
                <View style={styles.loggedSetList}>
                  {exercise.sets.length === 0 ? <Text style={styles.loggedSetEmpty}>Inga set ännu. Tryck på + Set.</Text> : null}
                  {exercise.sets.map((setEntry, index) => (
                    <View key={setEntry.id} style={styles.loggedSetRow}>
                      <Text style={styles.loggedSetTitle}>Set {index + 1}</Text>
                      <View style={styles.loggedSetMetrics}>
                        <Text style={styles.loggedSetMetricLabel}>Reps</Text>
                        <View style={styles.trainingStatActions}>
                          <Pressable style={styles.trainingStatButton} onPress={() => sessionAdjustSet(exercise.id, setEntry.id, 'reps', -1)}>
                            <Text style={styles.trainingStatButtonText}>-</Text>
                          </Pressable>
                          <Text style={styles.loggedSetMetricValue}>{setEntry.reps}</Text>
                          <Pressable style={styles.trainingStatButton} onPress={() => sessionAdjustSet(exercise.id, setEntry.id, 'reps', 1)}>
                            <Text style={styles.trainingStatButtonText}>+</Text>
                          </Pressable>
                        </View>
                      </View>
                      <View style={styles.loggedSetMetrics}>
                        <Text style={styles.loggedSetMetricLabel}>Vikt</Text>
                        <View style={styles.trainingStatActions}>
                          <Pressable style={styles.trainingStatButton} onPress={() => sessionAdjustSet(exercise.id, setEntry.id, 'weightKg', -2.5)}>
                            <Text style={styles.trainingStatButtonText}>-</Text>
                          </Pressable>
                          <Text style={styles.loggedSetMetricValue}>{setEntry.weightKg} kg</Text>
                          <Pressable style={styles.trainingStatButton} onPress={() => sessionAdjustSet(exercise.id, setEntry.id, 'weightKg', 2.5)}>
                            <Text style={styles.trainingStatButtonText}>+</Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
                <View style={styles.trainingButtons}>
                  <Button mode="contained" onPress={() => sessionAddSet(exercise.id)}>+ Set</Button>
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={styles.sessionBottomActions}>
            <Pressable style={styles.sessionNavButton} onPress={() => setView('home')}>
              <MaterialIcons name="arrow-back" size={24} color="#0F1419" />
            </Pressable>
            <Pressable style={styles.sessionFinishButton} onPress={saveCompletedWorkout}>
              <Text style={styles.sessionFinishButtonText}>
                {hasLoggedSessionContent ? 'Avsluta pass och spara' : 'Avsluta pass'}
              </Text>
            </Pressable>
            <Pressable style={styles.sessionPlusButton} onPress={() => openLibrary('session')}>
              <Text style={styles.sessionPlusButtonText}>+</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {view === 'historyDetail' && selectedHistoryWorkout ? (
        <View style={styles.screen}>
          <View style={styles.trainingSessionTop}>
            <Text style={styles.trainingTimer}>{resolveWorkoutDisplay(selectedHistoryWorkout).name}</Text>
            <Text style={styles.historyDetailMeta}>
              {resolveWorkoutDisplay(selectedHistoryWorkout).dateTimeLabel} • {resolveWorkoutDisplay(selectedHistoryWorkout).durationLabel}
            </Text>
          </View>
          <ScrollView contentContainerStyle={styles.listContent}>
            {selectedHistoryWorkout.exercises.length === 0 ? <Text style={styles.loggedSetEmpty}>Inga övningar sparade i passet.</Text> : null}
            {selectedHistoryWorkout.exercises.map((exercise) => (
              <View key={exercise.id} style={styles.trainingCard}>
                <Text style={styles.trainingTitle}>{exercise.name}</Text>
                <View style={styles.loggedSetList}>
                  {exercise.sets.length === 0 ? <Text style={styles.loggedSetEmpty}>Inga set registrerade.</Text> : null}
                  {exercise.sets.map((setEntry, index) => (
                    <View key={setEntry.id} style={styles.historySetRow}>
                      <Text style={styles.loggedSetTitle}>Set {index + 1}</Text>
                      <Text style={styles.historySetValue}>{setEntry.reps} reps</Text>
                      <Text style={styles.historySetValue}>{setEntry.weightKg} kg</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={styles.sessionBottomActions}>
            <Pressable style={styles.sessionFinishButton} onPress={() => setView('home')}>
              <Text style={styles.sessionFinishButtonText}>Tillbaka</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {view === 'builder' ? (
        <View style={styles.screen}>
          <View style={styles.trainingSessionTop}>
            <Text style={styles.trainingTimer}>{editingPlanId ? 'Redigera pass' : 'Skapa pass'}</Text>
          </View>
          <ScrollView contentContainerStyle={styles.listContent}>
            <TextInput value={builderName} onChangeText={setBuilderName} style={styles.input} placeholder="Namn på pass" placeholderTextColor={PLACEHOLDER_COLOR} />
            {builderExercises.length === 0 ? <Text style={styles.loggedSetEmpty}>Lägg till övningar med ＋.</Text> : null}
            {builderExercises.map((exercise) => (
              <View key={exercise.id} style={styles.trainingCard}>
                <View style={styles.trainingHeader}>
                  <Text style={styles.trainingTitle}>{exercise.name}</Text>
                  <Pressable onPress={() => setBuilderExercises((prev) => prev.filter((item) => item.id !== exercise.id))}>
                    <MaterialIcons name="delete" size={22} color="#EF9A9A" />
                  </Pressable>
                </View>
                <View style={styles.trainingBuilderRow}>
                  <Text style={styles.loggedSetMetricLabel}>Set</Text>
                  <View style={styles.trainingStatActions}>
                    <Pressable style={styles.trainingStatButton} onPress={() => setBuilderExercises((prev) => prev.map((item) => item.id === exercise.id ? { ...item, sets: Math.max(1, Math.min(20, item.sets - 1)) } : item))}>
                      <Text style={styles.trainingStatButtonText}>-</Text>
                    </Pressable>
                    <Text style={styles.loggedSetMetricValue}>{exercise.sets}</Text>
                    <Pressable style={styles.trainingStatButton} onPress={() => setBuilderExercises((prev) => prev.map((item) => item.id === exercise.id ? { ...item, sets: Math.max(1, Math.min(20, item.sets + 1)) } : item))}>
                      <Text style={styles.trainingStatButtonText}>+</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.loggedSetMetricLabel}>Reps</Text>
                  <View style={styles.trainingStatActions}>
                    <Pressable style={styles.trainingStatButton} onPress={() => setBuilderExercises((prev) => prev.map((item) => item.id === exercise.id ? { ...item, reps: Math.max(1, Math.min(50, item.reps - 1)) } : item))}>
                      <Text style={styles.trainingStatButtonText}>-</Text>
                    </Pressable>
                    <Text style={styles.loggedSetMetricValue}>{exercise.reps}</Text>
                    <Pressable style={styles.trainingStatButton} onPress={() => setBuilderExercises((prev) => prev.map((item) => item.id === exercise.id ? { ...item, reps: Math.max(1, Math.min(50, item.reps + 1)) } : item))}>
                      <Text style={styles.trainingStatButtonText}>+</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={styles.sessionBottomActions}>
            <Pressable style={styles.sessionNavButton} onPress={() => { setEditingPlanId(null); setView('home'); }}>
              <MaterialIcons name="arrow-back" size={24} color="#0F1419" />
            </Pressable>
            <Pressable style={styles.sessionFinishButton} onPress={saveBuilderPlan}>
              <Text style={styles.sessionFinishButtonText}>{editingPlanId ? 'Spara ändringar' : 'Spara pass'}</Text>
            </Pressable>
            <Pressable style={styles.sessionPlusButton} onPress={() => openLibrary('builder')}>
              <Text style={styles.sessionPlusButtonText}>+</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {view === 'saved' ? (
        <View style={styles.screen}>
          <View style={styles.trainingSessionTop}>
            <Text style={styles.trainingTimer}>Mina pass</Text>
          </View>
          <ScrollView contentContainerStyle={styles.listContent}>
            {workoutPlans.length === 0 ? <Text style={styles.loggedSetEmpty}>Inga skapade pass ännu.</Text> : null}
            {workoutPlans.map((plan) => (
              <View key={plan.id} style={styles.trainingCard}>
                <Text style={styles.trainingTitle}>{plan.name}</Text>
                <View style={styles.savedPlanActionsRow}>
                  <Button mode="outlined" style={styles.savedPlanActionButton} onPress={() => loadPlanForEditing(plan)}>
                    Visa/redigera pass
                  </Button>
                  <Button mode="contained" style={styles.savedPlanActionButton} onPress={() => startWorkoutFromPlan(plan)}>
                    Starta pass
                  </Button>
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={styles.sessionBottomActions}>
            <Pressable style={styles.sessionFinishButton} onPress={() => setView('home')}>
              <Text style={styles.sessionFinishButtonText}>Tillbaka</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Modal visible={gymLibraryVisible} transparent animationType="none" onRequestClose={closeGymLibrary}>
        <View style={styles.bottomSheetBackdrop}>
          <Animated.View
            renderToHardwareTextureAndroid
            style={[
              styles.bottomSheet,
              styles.gymBottomSheet,
              { transform: [{ translateY: gymSheetTranslateY }] },
            ]}
          >
            <View style={styles.gymDragZone} {...gymSheetPanResponder.panHandlers}>
              <View style={styles.bottomSheetHandle} />
            </View>
            <View style={styles.gymSheetContent}>
              <Text style={styles.bottomSheetTitle}>Gymbibliotek</Text>
              <TextInput
                value={gymLibraryQuery}
                onChangeText={setGymLibraryQuery}
                style={[styles.input, styles.librarySearch]}
                placeholder="Sök gymövning"
                placeholderTextColor={PLACEHOLDER_COLOR}
              />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.filterRow}
                contentContainerStyle={styles.filterRowContent}
              >
                {gymBodyPartFilters.map((tag) => {
                  const active = gymLibraryFilter === tag;
                  return (
                    <Pressable
                      key={`gym-filter-${tag}`}
                      style={[styles.chip, styles.gymFilterChip, active && styles.chipActive, active && styles.gymFilterChipActive]}
                      onPress={() =>
                        setGymLibraryFilter((prev) => (prev === tag ? null : tag))
                      }
                    >
                      <Text style={[styles.chipText, styles.gymFilterChipText, active && styles.chipTextActive]}>{tag}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" bounces={false} overScrollMode="never" contentContainerStyle={styles.libraryList}>
                {gymLibraryQuery.trim().length > 0 && !hasExactGymMatch ? (
                  <View style={styles.libraryItem}>
                    <View style={styles.libraryItemMain}>
                      <Text style={styles.libraryName}>Vill du lägga till "{gymLibraryQuery.trim()}"?</Text>
                      <View style={styles.libraryTagWrap}>
                        <View style={styles.libraryTag}>
                          <Text style={styles.libraryTagText}>Egen övning</Text>
                        </View>
                      </View>
                    </View>
                    <Button mode="contained-tonal" onPress={addCustomGymExercise}>
                      Lägg till
                    </Button>
                  </View>
                ) : null}
                {filteredGymLibrary.map((exercise) => (
                  <View key={`gym-lib-${exercise.id}`} style={styles.libraryItem}>
                    <View style={styles.libraryItemMain}>
                      <Text style={styles.libraryName}>{exercise.name}</Text>
                      <View style={styles.libraryTagWrap}>
                        {exercise.tags.map((tag) => (
                          <Pressable key={`${exercise.id}-${tag}`} style={styles.libraryTag} onPress={() => openGymCategoryEditor(exercise)}>
                            <Text style={styles.libraryTagText}>{tag}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                    <Button mode="contained-tonal" onPress={() => addLibraryExercise(exercise)}>
                      Välj
                    </Button>
                  </View>
                ))}
                {filteredGymLibrary.length === 0 ? <Text style={styles.logEmpty}>Inga övningar matchar filtret.</Text> : null}
              </ScrollView>
            </View>
          </Animated.View>
          {gymCategoryEditorVisible && (
            <View style={styles.categoryEditorOverlay}>
              <Pressable style={styles.categoryBackdropTapZone} onPress={closeGymCategoryEditor} />
              <View style={[styles.timePickerCard, styles.categoryModalCard]}>
                <Text style={styles.timePickerTitle}>Välj kategorier</Text>
                <View style={styles.gymDialogRow}>
                  <TextInput
                    value={gymCategoryCustomInput}
                    onChangeText={setGymCategoryCustomInput}
                    style={[styles.input, styles.gymDialogInput]}
                    placeholder="Egen kategori"
                    placeholderTextColor={PLACEHOLDER_COLOR}
                  />
                  <Button mode="contained-tonal" onPress={addGymCustomCategory}>
                    Lägg till
                  </Button>
                </View>
                <Text style={styles.categoryHintText}>Välj en eller flera kategorier</Text>
                <ScrollView style={styles.categoryDialogList} contentContainerStyle={styles.categoryChipListContent}>
                  <View style={styles.chipWrap}>
                    {gymCategoryChoices.map((tag) => (
                      <Pressable
                        key={`gym-category-${tag}`}
                        style={[styles.chip, gymCategoryDraftTags.includes(tag) && styles.chipActive]}
                        onPress={() => toggleGymCategoryDraft(tag)}
                      >
                        <Text style={[styles.chipText, gymCategoryDraftTags.includes(tag) && styles.chipTextActive]}>{tag}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
                <View style={styles.timePickerActions}>
                  <Button onPress={closeGymCategoryEditor}>Avbryt</Button>
                  <Button onPress={saveGymCategoryEditor}>Spara</Button>
                </View>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

function AnalysisScreen({
  exercises,
  logs,
}: {
  exercises: Exercise[];
  logs: ExerciseLog[];
}) {
  const days = useMemo(() => buildTimelineDays(), []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(exercises.map((exercise) => exercise.id));
  const [headerMonth, setHeaderMonth] = useState(monthTitle(new Date()));
  const [viewportWidth, setViewportWidth] = useState(Dimensions.get('window').width - 32);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    setSelected((prev) => {
      const existing = new Set(exercises.map((exercise) => exercise.id));
      const kept = prev.filter((id) => existing.has(id));
      if (kept.length > 0) return kept;
      return exercises.map((exercise) => exercise.id);
    });
  }, [exercises]);

  useEffect(() => {
    const id = setTimeout(() => {
      const todayIndex = 60;
      const x = Math.max(todayIndex * DAY_WIDTH - viewportWidth / 2 + DAY_WIDTH / 2, 0);
      scrollRef.current?.scrollTo({ x, animated: false });
    }, 50);
    return () => clearTimeout(id);
  }, [viewportWidth]);

  const chartHeight = 240;
  const selectedExercises = exercises.filter((exercise) => selected.includes(exercise.id));
  const dayCounts = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    days.forEach((day) => map.set(formatDateKey(day), {}));
    logs.forEach((log) => {
      const key = log.atIso.slice(0, 10);
      const perExercise = map.get(key);
      if (!perExercise) return;
      perExercise[log.exerciseId] = (perExercise[log.exerciseId] || 0) + 1;
    });
    return map;
  }, [days, logs]);
  const maxValue = Math.max(
    1,
    ...selectedExercises.map((exercise) => exercise.sets),
    ...days.flatMap((day) => selectedExercises.map((exercise) => dayCounts.get(formatDateKey(day))?.[exercise.id] || 0)),
  );

  return (
    <View style={styles.screen}>
      <View style={styles.dropdownRow}>
        <Button mode="outlined" icon="filter-variant" onPress={() => setMenuOpen(true)}>
          Välj övningar
        </Button>
        <Text style={styles.dropdownHint}>{selectedExercises.length} valda</Text>
      </View>
      <Portal>
        <Dialog visible={menuOpen} onDismiss={() => setMenuOpen(false)}>
          <Dialog.Title>Visa i analys</Dialog.Title>
          <Dialog.Content>
            {exercises.map((exercise) => (
              <Pressable
                key={exercise.id}
                onPress={() =>
                  setSelected((prev) =>
                    prev.includes(exercise.id) ? prev.filter((id) => id !== exercise.id) : [...prev, exercise.id],
                  )
                }
                style={styles.dropdownItem}
              >
                <View style={[styles.dot, { backgroundColor: exercise.color }]} />
                <Text style={styles.dropdownText}>{exercise.title}</Text>
                <Checkbox status={selected.includes(exercise.id) ? 'checked' : 'unchecked'} />
              </Pressable>
            ))}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setMenuOpen(false)}>Klar</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Text style={styles.monthTitle}>{headerMonth}</Text>
      <View style={styles.chartCard} onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}>
        <ScrollView
          horizontal
          ref={scrollRef}
          showsHorizontalScrollIndicator={false}
          onScroll={(event) => {
            const centerIndex = Math.round((event.nativeEvent.contentOffset.x + viewportWidth / 2) / DAY_WIDTH);
            const day = days[Math.max(0, Math.min(days.length - 1, centerIndex))];
            setHeaderMonth(monthTitle(day));
          }}
          scrollEventThrottle={16}
        >
          <View>
            <Svg width={days.length * DAY_WIDTH} height={chartHeight}>
              {days.map((day, index) => {
                const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                const isMonday = day.getDay() === 1;
                return (
                  <React.Fragment key={formatDateKey(day)}>
                    {isWeekend ? (
                      <Rect x={index * DAY_WIDTH} y={0} width={DAY_WIDTH} height={chartHeight - 30} fill="#131B24" />
                    ) : null}
                    {isMonday ? (
                      <Line x1={index * DAY_WIDTH} y1={0} x2={index * DAY_WIDTH} y2={chartHeight - 30} stroke="#2D3B49" />
                    ) : null}
                  </React.Fragment>
                );
              })}

              {days.map((day, index) => {
                const counts = dayCounts.get(formatDateKey(day)) || {};
                const bars = selectedExercises.length || 1;
                const w = (DAY_WIDTH - 12) / bars;
                return selectedExercises.map((exercise, barIndex) => {
                  const value = counts[exercise.id] || 0;
                  const h = (value / maxValue) * (chartHeight - 62);
                  const y = chartHeight - 36 - h;
                  const x = index * DAY_WIDTH + 6 + barIndex * w;
                  const targetY = chartHeight - 36 - (exercise.sets / maxValue) * (chartHeight - 62);
                  return (
                    <React.Fragment key={`${exercise.id}-${formatDateKey(day)}`}>
                      <Rect x={x} y={y} width={Math.max(3, w - 2)} height={h} fill={exercise.color} rx={2} />
                      <Line x1={x} y1={targetY} x2={x + Math.max(3, w - 2)} y2={targetY} stroke={exercise.color} strokeWidth={1.6} />
                    </React.Fragment>
                  );
                });
              })}
            </Svg>
            <View style={styles.axisRow}>
              {days.map((day, index) => {
                const isToday = index === 60;
                return (
                  <View key={`${formatDateKey(day)}-axis`} style={styles.axisDay}>
                    <Text style={styles.axisWeek}>{swedishWeekday(day)}</Text>
                    <Text style={[styles.axisDate, isToday && styles.todayText]}>
                      {shortDate(day)}
                      {isToday ? ' Idag' : ''}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        </ScrollView>
      </View>
      <FAB icon="plus" color="#000" style={[styles.fab, { backgroundColor: '#90CAF9' }]} />
    </View>
  );
}

/* ── Custom smooth slider (works great on both iOS & Android) ── */
const THUMB_R = 14;
const TRACK_H = 6;
const SLIDER_HIT = 48;

function SmoothSlider({
  value,
  onValueChange,
  onSlidingStart,
  onSlidingEnd,
  min = 1,
  max = 10,
  step = 1,
}: {
  value: number;
  onValueChange: (v: number) => void;
  onSlidingStart?: () => void;
  onSlidingEnd?: () => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const thumbOffset = useMemo(() => Animated.subtract(anim, new Animated.Value(THUMB_R)), [anim]);
  const trackRef = useRef<View>(null);
  const state = useRef({ w: 0, px: 0, dragging: false, val: value });
  const cb = useRef({ onValueChange, onSlidingStart, onSlidingEnd });
  cb.current = { onValueChange, onSlidingStart, onSlidingEnd };

  const v2p = (v: number) => ((v - min) / (max - min)) * state.current.w;
  const p2v = (px: number) => {
    const f = Math.max(0, Math.min(1, px / (state.current.w || 1)));
    return Math.max(min, Math.min(max, Math.round((min + f * (max - min)) / step) * step));
  };

  useEffect(() => {
    if (!state.current.dragging) {
      anim.setValue(v2p(value));
      state.current.val = value;
    }
  }, [value]);

  const measure = () => {
    trackRef.current?.measureInWindow((px, _py, w) => {
      state.current.px = px;
      state.current.w = w;
      if (!state.current.dragging) anim.setValue(v2p(state.current.val));
    });
  };

  const apply = (pageX: number) => {
    const v = p2v(pageX - state.current.px);
    anim.setValue(v2p(v));
    if (v !== state.current.val) {
      state.current.val = v;
      cb.current.onValueChange(v);
    }
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant(e) {
        state.current.dragging = true;
        cb.current.onSlidingStart?.();
        trackRef.current?.measureInWindow((px, _py, w) => {
          state.current.px = px;
          state.current.w = w;
          apply(e.nativeEvent.pageX);
        });
      },
      onPanResponderMove(e) {
        apply(e.nativeEvent.pageX);
      },
      onPanResponderRelease() {
        state.current.dragging = false;
        cb.current.onSlidingEnd?.();
      },
      onPanResponderTerminate() {
        state.current.dragging = false;
        cb.current.onSlidingEnd?.();
      },
    }),
  ).current;

  const steps = (max - min) / step;

  return (
    <View style={{ height: SLIDER_HIT, justifyContent: 'center' }}>
      <View ref={trackRef} onLayout={measure} {...pan.panHandlers} style={{ height: SLIDER_HIT, justifyContent: 'center' }}>
        {/* Track background */}
        <View
          style={{
            height: TRACK_H,
            borderRadius: TRACK_H / 2,
            backgroundColor: '#2C3A49',
          }}
        />
        {/* Step dots */}
        <View style={{ position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', top: (SLIDER_HIT - 4) / 2 }}>
          {Array.from({ length: steps + 1 }, (_, i) => (
            <View
              key={i}
              style={{
                width: 4,
                height: 4,
                borderRadius: 2,
                backgroundColor: i / steps <= (value - min) / (max - min) ? '#7BA4CC' : '#3D4F5F',
              }}
            />
          ))}
        </View>
        {/* Filled track */}
        <Animated.View
          style={{
            position: 'absolute',
            left: 0,
            top: (SLIDER_HIT - TRACK_H) / 2,
            height: TRACK_H,
            borderRadius: TRACK_H / 2,
            backgroundColor: '#5E81AC',
            width: anim,
          }}
        />
        {/* Thumb */}
        <Animated.View
          style={{
            position: 'absolute',
            width: THUMB_R * 2,
            height: THUMB_R * 2,
            borderRadius: THUMB_R,
            backgroundColor: '#E8EFF6',
            borderWidth: 2.5,
            borderColor: '#5E81AC',
            top: (SLIDER_HIT - THUMB_R * 2) / 2,
            transform: [{ translateX: thumbOffset }],
            ...Platform.select({
              ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.18,
                shadowRadius: 4,
              },
              android: { elevation: 4 },
            }),
          }}
        />
      </View>
    </View>
  );
}

function DiaryScreen({
  series,
  setSeries,
  onAddSeries,
}: {
  series: PainSeries[];
  setSeries: React.Dispatch<React.SetStateAction<PainSeries[]>>;
  onAddSeries: () => void;
}) {
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(series[0]?.id ?? null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<DiaryViewMode>('dag');
  const [month, setMonth] = useState(monthTitle(new Date()));
  const [viewportWidth, setViewportWidth] = useState(Dimensions.get('window').width - 32);
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 0]);
  const [scrollLocked, setScrollLocked] = useState(false);
  const chartScrollRef = useRef<ScrollView>(null);
  const diaryScrollRef = useRef<ScrollView>(null);
  const logRowYById = useRef<Record<string, number>>({});
  const logRowHeightById = useRef<Record<string, number>>({});
  const logWrapY = useRef(0);
  const suppressNextDeselect = useRef(false);
  const diaryScrollY = useRef(0);
  const chartTouchStart = useRef<{ x: number; y: number } | null>(null);
  const chartTouchMoved = useRef(false);

  useEffect(() => {
    if (!activeSeriesId && series[0]) setActiveSeriesId(series[0].id);
  }, [activeSeriesId, series]);

  const active = series.find((item) => item.id === activeSeriesId) || series[0];
  const allPoints = useMemo(() => {
    if (!active) return [];
    return active.entries
      .map((entry) => {
        const day = new Date(entry.atIso);
        const y = 14 + ((10 - entry.value) / 9) * 186;
        return { day, y, entry };
      })
      .filter((item): item is { day: Date; y: number; entry: PainEntry } => !!item)
      .sort((a, b) => new Date(a.entry.atIso).getTime() - new Date(b.entry.atIso).getTime());
  }, [active]);
  const points = useMemo(
    () => allPoints.map((point, index) => ({ ...point, x: CHART_SIDE_PADDING + index * ENTRY_SPACING })),
    [allPoints],
  );
  const chartWidth = Math.max(viewportWidth, CHART_SIDE_PADDING * 2 + Math.max(points.length - 1, 0) * ENTRY_SPACING);
  const latestTime = allPoints.length > 0 ? new Date(allPoints[allPoints.length - 1].entry.atIso).getTime() : Date.now();
  const viewStartTime = latestTime - DIARY_VIEW_CONFIG[viewMode].spanMs;

  useEffect(() => {
    const id = setTimeout(() => {
      const startIndex = points.findIndex((point) => new Date(point.entry.atIso).getTime() >= viewStartTime);
      const startX = startIndex >= 0 ? points[startIndex].x - CHART_SIDE_PADDING : chartWidth - viewportWidth;
      const x = Math.max(Math.min(startX, chartWidth - viewportWidth), 0);
      chartScrollRef.current?.scrollTo({ x, animated: false });
      setVisibleRange([x, x + viewportWidth]);
      if (points.length > 0) {
        setMonth(monthTitle(points[points.length - 1].day));
      }
    }, 80);
    return () => clearTimeout(id);
  }, [viewportWidth, chartWidth, points, viewMode, viewStartTime]);

  const curve = createCurvePath(points.map((point) => ({ x: point.x, y: point.y })));
  const visibleEntries = points
    .filter((point) => point.x >= visibleRange[0] && point.x <= visibleRange[1] && point.entry.note.trim().length > 0)
    .map((point) => ({ ...point, dayColor: DAY_COLORS[point.day.getDay()] }));
  const blockNextDeselect = () => {
    suppressNextDeselect.current = true;
    requestAnimationFrame(() => {
      suppressNextDeselect.current = false;
    });
  };
  const selectEntry = (entryId: string, fromGraphPress: boolean) => {
    const clickedPoint = points.find((point) => point.entry.id === entryId);
    if (fromGraphPress && (!clickedPoint || clickedPoint.entry.note.trim().length === 0)) {
      return;
    }
    setSelectedEntryId(entryId);
    if (!fromGraphPress) return;
    const y = logRowYById.current[entryId];
    if (typeof y === 'number') {
      const rowHeight = logRowHeightById.current[entryId] ?? 56;
      const rowTop = logWrapY.current + y;
      const rowBottom = rowTop + rowHeight;
      const viewportTop = diaryScrollY.current + 90;
      const viewportBottom = diaryScrollY.current + Dimensions.get('window').height - 120;
      const isAlreadyVisible = rowTop >= viewportTop && rowBottom <= viewportBottom;
      if (!isAlreadyVisible) {
        diaryScrollRef.current?.scrollTo({ y: Math.max(0, rowTop - 120), animated: true });
      }
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        ref={diaryScrollRef}
        contentContainerStyle={styles.listContent}
        scrollEnabled={!scrollLocked}
        nestedScrollEnabled
        onScroll={(event) => {
          diaryScrollY.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        {series.map((item) => (
          <Pressable
            key={item.id}
            onTouchStart={() => setActiveSeriesId(item.id)}
            style={[styles.seriesCard, active?.id === item.id && styles.activeSeriesCard]}
          >
            <View style={styles.seriesHeader}>
              <Text style={styles.seriesTitle}>{item.name}</Text>
              <Pressable onPress={() => setSeries((prev) => prev.filter((s) => s.id !== item.id))}>
                <MaterialIcons name="delete" size={24} color="#EF9A9A" />
              </Pressable>
            </View>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{item.value}</Text>
            </View>
            <SmoothSlider
              min={1}
              max={10}
              step={1}
              value={item.value}
              onValueChange={(v) =>
                setSeries((prev) => prev.map((s) => (s.id === item.id ? { ...s, value: v } : s)))
              }
              onSlidingStart={() => setScrollLocked(true)}
              onSlidingEnd={() => setScrollLocked(false)}
            />
            <TextInput
              value={item.draftNote}
              onChangeText={(text) => setSeries((prev) => prev.map((s) => (s.id === item.id ? { ...s, draftNote: text } : s)))}
              style={[styles.input, styles.noteInput]}
              placeholder="Hur mår du just nu?"
              placeholderTextColor={PLACEHOLDER_COLOR}
              multiline
            />
            <View style={styles.seriesButtons}>
              <Button
                mode="contained"
                onPress={() =>
                  setSeries((prev) =>
                    prev.map((s) =>
                      s.id === item.id
                        ? {
                            ...s,
                            draftNote: '',
                            entries: [
                              ...s.entries,
                              {
                                id: `${Date.now()}-${Math.random()}`,
                                atIso: new Date().toISOString(),
                                value: s.value,
                                note: s.draftNote.trim(),
                              },
                            ],
                          }
                        : s,
                    ),
                  )
                }
              >
                Spara
              </Button>
              <Button
                mode="outlined"
                onPress={() => setSeries((prev) => prev.map((s) => (s.id === item.id ? { ...s, draftNote: '' } : s)))}
              >
                Ångra
              </Button>
            </View>
          </Pressable>
        ))}

        <View style={styles.diaryChartHeader}>
          <Text style={[styles.monthTitle, styles.diaryMonthTitle]}>{month}</Text>
          <View style={styles.diaryViewButtonWrap}>
            <Button
              mode="outlined"
              compact
              onPress={() => {
                setViewMode((prev) => DIARY_VIEW_ORDER[(DIARY_VIEW_ORDER.indexOf(prev) + 1) % DIARY_VIEW_ORDER.length]);
              }}
            >
              {DIARY_VIEW_CONFIG[viewMode].label}
            </Button>
          </View>
        </View>
        <View
          style={styles.chartCard}
          onTouchStart={(event) => {
            chartTouchStart.current = {
              x: event.nativeEvent.pageX,
              y: event.nativeEvent.pageY,
            };
            chartTouchMoved.current = false;
          }}
          onTouchMove={(event) => {
            if (!chartTouchStart.current) return;
            const dx = Math.abs(event.nativeEvent.pageX - chartTouchStart.current.x);
            const dy = Math.abs(event.nativeEvent.pageY - chartTouchStart.current.y);
            if (dx > 8 || dy > 8) chartTouchMoved.current = true;
          }}
          onTouchEnd={() => {
            if (suppressNextDeselect.current) return;
            if (chartTouchMoved.current) return;
            setSelectedEntryId(null);
            chartTouchStart.current = null;
          }}
          onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
        >
          <ScrollView
            horizontal
            ref={chartScrollRef}
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled
            directionalLockEnabled
            scrollEventThrottle={16}
            onScroll={(event) => {
              const x = event.nativeEvent.contentOffset.x;
              setVisibleRange([x, x + viewportWidth]);
              if (points.length === 0) return;
              const centerX = x + viewportWidth / 2;
              const closest = points.reduce((best, point) => (
                Math.abs(point.x - centerX) < Math.abs(best.x - centerX) ? point : best
              ));
              setMonth(monthTitle(closest.day));
            }}
          >
            <View>
              <View style={[styles.diaryChartCanvas, { width: chartWidth }]}>
                <Svg width={chartWidth} height={230}>
                  {[1, 3, 5, 7, 10].map((label) => {
                    const y = 14 + ((10 - label) / 9) * 186;
                    return <Line key={label} x1={0} y1={y} x2={chartWidth} y2={y} stroke="#2A3744" />;
                  })}
                  <Path d={curve} fill="none" stroke="#7FC8FF" strokeOpacity={0.3} strokeWidth={7} />
                  <Path d={curve} fill="none" stroke="#7FC8FF" strokeWidth={3.6} />
                  {points.map((point) => {
                    const hasNote = point.entry.note.trim().length > 0;
                    const selected = point.entry.id === selectedEntryId;
                    const color = hasNote ? DAY_COLORS[point.day.getDay()] : '#B0BEC5';
                    return (
                      <React.Fragment key={point.entry.id}>
                        {selected ? <Circle cx={point.x} cy={point.y} r={12} fill="rgba(127,200,255,0.35)" /> : null}
                        <Circle cx={point.x} cy={point.y} r={selected ? 6 : 4} fill={color} />
                      </React.Fragment>
                    );
                  })}
                </Svg>
                <View pointerEvents="box-none" style={styles.diaryPointOverlay}>
                  {points.map((point) => (
                    <Pressable
                      key={`hit-${point.entry.id}`}
                      hitSlop={6}
                      style={[styles.diaryPointHitbox, { left: point.x - 12, top: point.y - 12 }]}
                      onPress={(event) => {
                        event.stopPropagation();
                        blockNextDeselect();
                        selectEntry(point.entry.id, true);
                      }}
                    />
                  ))}
                </View>
              </View>
              <View style={[styles.diaryAxisRow, { width: chartWidth }]}>
                {points.map((point) => (
                  <View key={`axis-${point.entry.id}`} style={[styles.diaryAxisItem, { left: point.x - ENTRY_SPACING / 2, width: ENTRY_SPACING }]}>
                    <Text style={styles.diaryAxisDate}>{shortDate(point.day)}</Text>
                    <Text style={styles.diaryAxisTime}>{shortTime(point.day)}</Text>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>
        </View>

        <Pressable
          style={styles.logWrap}
          onPress={() => setSelectedEntryId(null)}
          onLayout={(event) => {
            logWrapY.current = event.nativeEvent.layout.y;
          }}
        >
          {visibleEntries.length === 0 ? <Text style={styles.logEmpty}>Inga registreringar i aktuell vy.</Text> : null}
          {visibleEntries.map((item) => (
            <Pressable
              key={`log-${item.entry.id}`}
              style={[styles.logRow, selectedEntryId === item.entry.id && styles.logRowActive]}
              onPress={(event) => {
                event.stopPropagation();
                blockNextDeselect();
                selectEntry(item.entry.id, false);
              }}
              onLayout={(event) => {
                logRowYById.current[item.entry.id] = event.nativeEvent.layout.y;
                logRowHeightById.current[item.entry.id] = event.nativeEvent.layout.height;
              }}
            >
              <View style={[styles.dot, { backgroundColor: item.dayColor, marginTop: 4 }]} />
              <View style={styles.logTextWrap}>
                <Text style={styles.logTime}>{new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.entry.atIso))}</Text>
                <Text style={[styles.logNote, selectedEntryId === item.entry.id && styles.logNoteActive]}>
                  {item.entry.note}
                </Text>
              </View>
            </Pressable>
          ))}
        </Pressable>
      </ScrollView>
      <FAB icon="plus" color="#000" style={[styles.fab, { backgroundColor: '#FFE082' }]} onPress={onAddSeries} />
    </View>
  );
}

export default function App() {
  const [exercises, setExercises] = useState<Exercise[]>([
    {
      id: '1',
      title: 'Knäböj',
      description: 'Utför kontrollerade knäböj med neutral rygg. Pausa 1 sekund i bottenläget.',
      sets: 3,
      reps: 10,
      daysLabel: 'Mån, Ons, Fre',
      times: ['07:00', '10:00', '13:00'],
      remindersOn: true,
      color: SERIES_COLORS[0],
    },
    {
      id: '2',
      title: 'Utfall',
      description: 'Stega fram och håll överkroppen upprätt. Växla ben mellan repetitionerna.',
      sets: 2,
      reps: 12,
      weightKg: 8,
      daysLabel: 'Varje dag',
      times: ['08:00', '18:30'],
      remindersOn: false,
      color: SERIES_COLORS[1],
    },
  ]);
  const [logs, setLogs] = useState<ExerciseLog[]>([]);
  const [painSeries, setPainSeries] = useState<PainSeries[]>([
    { id: 'p1', name: 'Nacke', value: 4, draftNote: '', entries: buildSeedPainEntries('nacke', 4) },
    { id: 'p2', name: 'Ländrygg', value: 3, draftNote: '', entries: buildSeedPainEntries('rygg', 3) },
  ]);
  const [workoutPlans, setWorkoutPlans] = useState<WorkoutPlan[]>([]);
  const [completedWorkouts, setCompletedWorkouts] = useState<CompletedWorkout[]>([]);
  const [rehabLibraryExercises, setRehabLibraryExercises] = useState<LibraryExercise[]>(LIBRARY_EXERCISES);
  const [gymLibraryExercises, setGymLibraryExercises] = useState<LibraryExercise[]>(GYM_LIBRARY_EXERCISES);
  const [newSeriesDialog, setNewSeriesDialog] = useState(false);
  const [newSeriesName, setNewSeriesName] = useState('');
  const [libraryVisible, setLibraryVisible] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryFilters, setLibraryFilters] = useState<string[]>([]);
  const [wizardExercise, setWizardExercise] = useState<LibraryExercise | null>(null);
  const [wizardMode, setWizardMode] = useState<WizardMode>('create');
  const [wizardExerciseId, setWizardExerciseId] = useState<string | null>(null);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardDays, setWizardDays] = useState<WeekdayKey[]>(['mon', 'wed', 'fri']);
  const [wizardSets, setWizardSets] = useState('3');
  const [wizardReps, setWizardReps] = useState('10');
  const [wizardWeight, setWizardWeight] = useState('');
  const [wizardTimesPerDay, setWizardTimesPerDay] = useState('1');
  const [wizardTimes, setWizardTimes] = useState<string[]>(['09:00']);
  const [timePickerIndex, setTimePickerIndex] = useState<number | null>(null);
  const [timeDraftHour, setTimeDraftHour] = useState(9);
  const [timeDraftMinute, setTimeDraftMinute] = useState(0);
  const [deleteDialogExercise, setDeleteDialogExercise] = useState<Exercise | null>(null);
  const [rehabCategoryEditorVisible, setRehabCategoryEditorVisible] = useState(false);
  const [rehabCategoryEditorExerciseId, setRehabCategoryEditorExerciseId] = useState<string | null>(null);
  const [rehabCategoryDraftTags, setRehabCategoryDraftTags] = useState<string[]>([]);
  const [rehabCategoryCustomInput, setRehabCategoryCustomInput] = useState('');
  const [isHydrated, setIsHydrated] = useState(false);
  const librarySheetMaxDrag = Math.round(Dimensions.get('window').height * 0.92);
  const librarySheetTranslateY = useRef(new Animated.Value(0)).current;
  const librarySheetStartY = useRef(0);

  useEffect(() => {
    const loadPersistedState = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as PersistedState;
        if (Array.isArray(parsed.exercises)) setExercises(parsed.exercises);
        if (Array.isArray(parsed.logs)) setLogs(parsed.logs);
        if (Array.isArray(parsed.painSeries)) {
          const hasAnyEntries = parsed.painSeries.some(
            (item) => Array.isArray(item.entries) && item.entries.length > 0,
          );
          setPainSeries(
            hasAnyEntries
              ? parsed.painSeries.map((item) => {
                  if (item.id === 'p1') {
                    return { ...item, entries: mergeEntriesWithSeed(item.entries || [], 'nacke', 4) };
                  }
                  if (item.id === 'p2') {
                    return { ...item, entries: mergeEntriesWithSeed(item.entries || [], 'rygg', 3) };
                  }
                  return item;
                })
              : [
                  { id: 'p1', name: 'Nacke', value: 4, draftNote: '', entries: buildSeedPainEntries('nacke', 4) },
                  { id: 'p2', name: 'Ländrygg', value: 3, draftNote: '', entries: buildSeedPainEntries('rygg', 3) },
                ],
          );
        }
        if (Array.isArray(parsed.workoutPlans)) setWorkoutPlans(parsed.workoutPlans);
        if (Array.isArray(parsed.completedWorkouts)) setCompletedWorkouts(parsed.completedWorkouts);
        if (Array.isArray(parsed.rehabLibraryExercises)) setRehabLibraryExercises(parsed.rehabLibraryExercises);
        if (Array.isArray(parsed.gymLibraryExercises)) setGymLibraryExercises(parsed.gymLibraryExercises);
      } catch {
        // Ignore parse/storage issues and keep defaults.
      } finally {
        setIsHydrated(true);
      }
    };
    loadPersistedState();
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    const payload: PersistedState = {
      exercises,
      logs,
      painSeries,
      workoutPlans,
      completedWorkouts,
      rehabLibraryExercises,
      gymLibraryExercises,
    };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch(() => {
      // Ignore temporary storage failures.
    });
  }, [exercises, logs, painSeries, workoutPlans, completedWorkouts, rehabLibraryExercises, gymLibraryExercises, isHydrated]);

  /* ── Notification: refs for latest state (used inside listeners) ── */
  const exercisesRef = useRef(exercises);
  exercisesRef.current = exercises;
  const logsRef = useRef(logs);
  logsRef.current = logs;

  /* ── Notification: request permissions + set up action category ── */
  useEffect(() => {
    (async () => {
      if (!Device.isDevice) return;

      // Request permission (iOS shows a dialog, Android auto-grants)
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      if (existingStatus !== 'granted') {
        await Notifications.requestPermissionsAsync();
      }

      // Android notification channel
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
          name: 'Övningspåminnelser',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          sound: 'default',
        });
      }

      // Notification category with action buttons
      await Notifications.setNotificationCategoryAsync(NOTIFICATION_CATEGORY_ID, [
        {
          identifier: 'done',
          buttonTitle: 'Gjort ✓',
          options: { opensAppToForeground: false },
        },
        {
          identifier: 'snooze',
          buttonTitle: 'Snooze 10 min',
          options: { opensAppToForeground: false },
        },
      ]);
    })();
  }, []);

  /* ── Notification: handle user action on a notification (Gjort / Snooze / tap) ── */
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      async (response) => {
        const data = response.notification.request.content.data as {
          exerciseId?: string;
          exerciseTitle?: string;
          exerciseSets?: number;
          exerciseReps?: number;
          scheduledTimeIso?: string;
        };
        const actionId = response.actionIdentifier;

        if (actionId === 'done' && data.exerciseId) {
          // Register the exercise as done (same as tapping "Registrera" in the app)
          setLogs((prev) => [
            ...prev,
            { exerciseId: data.exerciseId!, atIso: new Date().toISOString() },
          ]);
        } else if (actionId === 'snooze' && data.exerciseId) {
          // Schedule a follow-up reminder in 10 minutes
          try {
            await Notifications.scheduleNotificationAsync({
              content: {
                title: 'Påminnelse: Övning!',
                body: `${data.exerciseTitle || 'Övning'} – ${data.exerciseSets ?? ''} set × ${data.exerciseReps ?? ''} reps`,
                categoryIdentifier: NOTIFICATION_CATEGORY_ID,
                data,
                sound: true,
                ...(Platform.OS === 'android' ? { channelId: NOTIFICATION_CHANNEL_ID } : {}),
              },
              trigger: {
                type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
                seconds: SNOOZE_MINUTES * 60,
                repeats: false,
              },
            });
          } catch {
            // Ignore snooze scheduling failures
          }
        }
        // DEFAULT_ACTION_IDENTIFIER = user tapped the notification body → app opens normally
      },
    );

    // Also handle the case where the app was killed and opened via notification tap
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data as {
        exerciseId?: string;
      };
      const actionId = response.actionIdentifier;
      if (actionId === 'done' && data.exerciseId) {
        setLogs((prev) => [
          ...prev,
          { exerciseId: data.exerciseId!, atIso: new Date().toISOString() },
        ]);
      }
    });

    return () => subscription.remove();
  }, []);

  /* ── Notification: schedule / reschedule whenever exercises or logs change ── */
  useEffect(() => {
    if (!isHydrated) return;
    // Small debounce so rapid state changes don't cause excessive rescheduling
    const timer = setTimeout(() => {
      scheduleExerciseNotifications(exercises, logs).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [exercises, logs, isHydrated]);

  /* ── Notification: reschedule when the app comes back to the foreground ── */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && isHydrated) {
        scheduleExerciseNotifications(exercisesRef.current, logsRef.current).catch(() => {});
      }
    });
    return () => subscription.remove();
  }, [isHydrated]);

  const closeTimePicker = () => setTimePickerIndex(null);
  const openLibrarySheet = useCallback(() => {
    librarySheetTranslateY.setValue(0);
    setLibraryVisible(true);
  }, [librarySheetTranslateY]);
  const closeLibrarySheet = useCallback(() => {
    Animated.timing(librarySheetTranslateY, {
      toValue: librarySheetMaxDrag,
      duration: 250,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setLibraryVisible(false);
    });
  }, [librarySheetMaxDrag, librarySheetTranslateY]);
  const librarySheetCloseThreshold = Math.round(librarySheetMaxDrag * 0.25);
  const librarySheetPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 6,
      onMoveShouldSetPanResponderCapture: (_, gesture) => gesture.dy > 6,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        librarySheetTranslateY.stopAnimation((value) => {
          librarySheetStartY.current = value;
        });
      },
      onPanResponderMove: (_, gesture) => {
        const next = Math.max(0, Math.min(librarySheetMaxDrag, librarySheetStartY.current + gesture.dy));
        librarySheetTranslateY.setValue(next);
      },
      onPanResponderRelease: (_, gesture) => {
        const releaseY = Math.max(0, Math.min(librarySheetMaxDrag, librarySheetStartY.current + gesture.dy));
        if (releaseY > librarySheetCloseThreshold) {
          closeLibrarySheet();
          return;
        }
        Animated.timing(librarySheetTranslateY, {
          toValue: 0,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;
  const resetWizard = () => {
    setWizardExercise(null);
    setWizardMode('create');
    setWizardExerciseId(null);
    setWizardStep(0);
    setWizardDays(['mon', 'wed', 'fri']);
    setWizardSets('3');
    setWizardReps('10');
    setWizardWeight('');
    setWizardTimesPerDay('1');
    setWizardTimes(['09:00']);
    closeTimePicker();
  };
  const filteredLibrary = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    return rehabLibraryExercises.filter((exercise) => {
      const matchesQuery =
        query.length === 0 ||
        exercise.name.toLowerCase().includes(query) ||
        exercise.tags.some((tag) => tag.toLowerCase().includes(query));
      const matchesFilter = libraryFilters.length === 0 || libraryFilters.every((tag) => exercise.tags.includes(tag));
      return matchesQuery && matchesFilter;
    });
  }, [libraryFilters, libraryQuery, rehabLibraryExercises]);
  const rehabBodyPartFilters = useMemo(
    () => [...new Set(rehabLibraryExercises.flatMap((exercise) => exercise.tags))],
    [rehabLibraryExercises],
  );
  const rehabCategoryChoices = useMemo(() => {
    const combined = [...rehabBodyPartFilters, ...rehabCategoryDraftTags];
    return [...new Set(combined)].sort((a, b) => a.localeCompare(b, 'sv-SE'));
  }, [rehabBodyPartFilters, rehabCategoryDraftTags]);
  const hasExactRehabMatch = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    if (query.length === 0) return true;
    return rehabLibraryExercises.some((exercise) => exercise.name.toLowerCase() === query);
  }, [rehabLibraryExercises, libraryQuery]);
  const addCustomRehabExercise = () => {
    const name = libraryQuery.trim();
    if (!name) return;
    const existing = rehabLibraryExercises.find((exercise) => exercise.name.toLowerCase() === name.toLowerCase());
    const nextExercise = existing || { id: `rehab-custom-${Date.now()}`, name, tags: ['Egen'] };
    if (!existing) {
      setRehabLibraryExercises((prev) => [nextExercise, ...prev]);
    }
    librarySheetTranslateY.setValue(0);
    setLibraryVisible(false);
    setWizardExercise(nextExercise);
    setWizardMode('create');
    setWizardExerciseId(null);
    setWizardStep(0);
    setLibraryQuery('');
    setLibraryFilters([]);
  };
  const openRehabCategoryEditor = (exercise: LibraryExercise) => {
    setRehabCategoryEditorExerciseId(exercise.id);
    setRehabCategoryDraftTags(exercise.tags);
    setRehabCategoryCustomInput('');
    setRehabCategoryEditorVisible(true);
  };
  const closeRehabCategoryEditor = () => {
    setRehabCategoryEditorVisible(false);
  };
  const toggleRehabCategoryDraft = (tag: string) => {
    setRehabCategoryDraftTags((prev) => (prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]));
  };
  const addRehabCustomCategory = () => {
    const next = normalizeCategoryTag(rehabCategoryCustomInput);
    if (!next) return;
    setRehabCategoryDraftTags((prev) => (prev.includes(next) ? prev : [...prev, next]));
    setRehabCategoryCustomInput('');
  };
  const saveRehabCategoryEditor = () => {
    if (!rehabCategoryEditorExerciseId) return;
    const cleanedTags = [...new Set(rehabCategoryDraftTags.map((tag) => normalizeCategoryTag(tag)).filter(Boolean))];
    if (cleanedTags.length === 0) {
      Alert.alert('Välj kategori', 'Lägg till minst en kategori för övningen.');
      return;
    }
    setRehabLibraryExercises((prev) =>
      prev.map((exercise) => (exercise.id === rehabCategoryEditorExerciseId ? { ...exercise, tags: cleanedTags } : exercise)),
    );
    setRehabCategoryEditorVisible(false);
    setRehabCategoryEditorExerciseId(null);
    setRehabCategoryCustomInput('');
  };
  useEffect(() => {
    const count = Math.max(1, Math.min(6, Number.parseInt(wizardTimesPerDay, 10) || 1));
    setWizardTimes((prev) => {
      if (prev.length === count) return prev;
      if (prev.length > count) return prev.slice(0, count);
      const next = [...prev];
      while (next.length < count) next.push(next[next.length - 1] || '09:00');
      return next;
    });
  }, [wizardTimesPerDay]);
  useEffect(() => {
    if (timePickerIndex === null) return;
    if (timePickerIndex < wizardTimes.length) return;
    closeTimePicker();
  }, [timePickerIndex, wizardTimes.length]);
  const openEditWizard = (exercise: Exercise) => {
    const fromLibrary = rehabLibraryExercises.find((item) => item.name === exercise.title);
    const tagsFromDescription = exercise.description.startsWith('Kroppsdelar:')
      ? exercise.description
          .replace('Kroppsdelar:', '')
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [];
    const tags = fromLibrary?.tags || tagsFromDescription;
    const parsedDays =
      exercise.daysLabel === 'Varje dag'
        ? WEEKDAY_CHIPS.map((day) => day.key)
        : exercise.daysLabel
            .split(',')
            .map((label) => label.trim().toLowerCase())
            .map((label) => WEEKDAY_KEY_BY_LABEL[label])
            .filter((value): value is WeekdayKey => !!value);
    setLibraryVisible(false);
    setWizardExercise({
      id: fromLibrary?.id || `edit-${exercise.id}`,
      name: exercise.title,
      tags: tags.length > 0 ? tags : ['Rehab'],
    });
    setWizardMode('edit');
    setWizardExerciseId(exercise.id);
    setWizardStep(0);
    setWizardDays(parsedDays.length > 0 ? parsedDays : ['mon']);
    setWizardSets(`${Math.max(1, exercise.sets || 1)}`);
    setWizardReps(`${Math.max(1, exercise.reps || 1)}`);
    setWizardWeight(typeof exercise.weightKg === 'number' ? `${exercise.weightKg}` : '');
    setWizardTimesPerDay(`${Math.max(1, exercise.times.length || 1)}`);
    setWizardTimes(exercise.times.length > 0 ? exercise.times : ['09:00']);
  };
  const paperTheme = {
    ...MD3DarkTheme,
    colors: {
      ...MD3DarkTheme.colors,
      primary: '#81C784',
      secondary: '#90CAF9',
      background: '#0F1419',
      surface: '#151D26',
      onSurface: '#E3EAF2',
      outline: '#33414F',
    },
  };
  const navigationTheme = {
    ...NavigationDarkTheme,
    colors: {
      ...NavigationDarkTheme.colors,
      primary: '#81C784',
      background: '#0F1419',
      card: '#151D26',
      text: '#E3EAF2',
      border: '#24313E',
    },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PaperProvider theme={paperTheme}>
        <NavigationContainer theme={navigationTheme}>
          <StatusBar style="light" />
          <Tab.Navigator
            screenOptions={({ route }) => ({
              headerTitleAlign: 'center',
              headerStyle: { backgroundColor: '#151D26' },
              headerTintColor: '#E3EAF2',
              tabBarStyle: { backgroundColor: '#151D26', borderTopColor: '#24313E' },
              tabBarActiveTintColor: '#81C784',
              tabBarInactiveTintColor: '#90A4B8',
              tabBarIcon: ({ color, size }) => {
                if (route.name === 'Hem') return <MaterialIcons name="home" size={size} color={color} />;
                if (route.name === 'Analys') return <MaterialIcons name="insights" size={size} color={color} />;
                if (route.name === 'Träning') return <MaterialCommunityIcons name="dumbbell" size={size} color={color} />;
                return <MaterialIcons name="menu-book" size={size} color={color} />;
              },
            })}
          >
            <Tab.Screen
              name="Hem"
              options={{ title: 'NapHab' }}
            >
              {() => (
                <HomeScreen
                  exercises={exercises}
                  setExercises={setExercises}
                  onQuickLog={(exerciseId) => setLogs((prev) => [...prev, { exerciseId, atIso: new Date().toISOString() }])}
                  onAddExercise={openLibrarySheet}
                  onEditExercise={openEditWizard}
                  onDeleteExercise={(exercise) => setDeleteDialogExercise(exercise)}
                />
              )}
            </Tab.Screen>
            <Tab.Screen name="Träning" options={{ title: 'Träning' }}>
              {() => (
                <TrainingScreen
                  workoutPlans={workoutPlans}
                  setWorkoutPlans={setWorkoutPlans}
                  completedWorkouts={completedWorkouts}
                  setCompletedWorkouts={setCompletedWorkouts}
                  gymLibraryExercises={gymLibraryExercises}
                  setGymLibraryExercises={setGymLibraryExercises}
                />
              )}
            </Tab.Screen>
            <Tab.Screen name="Analys" options={{ title: 'Analys' }}>
              {() => <AnalysisScreen exercises={exercises} logs={logs} />}
            </Tab.Screen>
            <Tab.Screen name="Dagbok" options={{ title: 'Dagbok' }}>
              {() => <DiaryScreen series={painSeries} setSeries={setPainSeries} onAddSeries={() => setNewSeriesDialog(true)} />}
            </Tab.Screen>
          </Tab.Navigator>
        </NavigationContainer>

        <Modal visible={libraryVisible} transparent animationType="none" onRequestClose={closeLibrarySheet}>
          <View style={styles.bottomSheetBackdrop}>
            <Animated.View
              renderToHardwareTextureAndroid
              style={[
                styles.bottomSheet,
                styles.libraryBottomSheet,
                { transform: [{ translateY: librarySheetTranslateY }] },
              ]}
            >
              <View style={styles.libraryDragZone} {...librarySheetPanResponder.panHandlers}>
                <View style={styles.bottomSheetHandle} />
              </View>
              <View style={styles.librarySheetContent}>
              <Text style={styles.bottomSheetTitle}>Träningsbibliotek</Text>
              <TextInput
                value={libraryQuery}
                onChangeText={setLibraryQuery}
                style={[styles.input, styles.librarySearch]}
                placeholder="Sök övning"
                placeholderTextColor={PLACEHOLDER_COLOR}
              />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.filterRow}
                contentContainerStyle={styles.filterRowContent}
              >
                {rehabBodyPartFilters.map((tag) => {
                  const active = libraryFilters.includes(tag);
                  return (
                    <Pressable
                      key={tag}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() =>
                        setLibraryFilters((prev) =>
                          prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag],
                        )
                      }
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{tag}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" bounces={false} overScrollMode="never" contentContainerStyle={styles.libraryList}>
                {libraryQuery.trim().length > 0 && !hasExactRehabMatch ? (
                  <View style={styles.libraryItem}>
                    <View style={styles.libraryItemMain}>
                      <Text style={styles.libraryName}>Vill du lägga till "{libraryQuery.trim()}"?</Text>
                      <View style={styles.libraryTagWrap}>
                        <View style={styles.libraryTag}>
                          <Text style={styles.libraryTagText}>Egen övning</Text>
                        </View>
                      </View>
                    </View>
                    <Button mode="contained-tonal" onPress={addCustomRehabExercise}>
                      Lägg till
                    </Button>
                  </View>
                ) : null}
                {filteredLibrary.map((exercise) => (
                  <View key={exercise.id} style={styles.libraryItem}>
                    <View style={styles.libraryItemMain}>
                      <Text style={styles.libraryName}>{exercise.name}</Text>
                      <View style={styles.libraryTagWrap}>
                        {exercise.tags.map((tag) => (
                          <Pressable key={`${exercise.id}-${tag}`} style={styles.libraryTag} onPress={() => openRehabCategoryEditor(exercise)}>
                            <Text style={styles.libraryTagText}>{tag}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                    <Button
                      mode="contained-tonal"
                      onPress={() => {
                        librarySheetTranslateY.setValue(0);
                        setLibraryVisible(false);
                        setWizardExercise(exercise);
                        setWizardMode('create');
                        setWizardExerciseId(null);
                        setWizardStep(0);
                      }}
                    >
                      Välj
                    </Button>
                  </View>
                ))}
                {filteredLibrary.length === 0 ? <Text style={styles.logEmpty}>Inga övningar matchar filtret.</Text> : null}
              </ScrollView>
              </View>
            </Animated.View>
            {rehabCategoryEditorVisible && (
              <View style={styles.categoryEditorOverlay}>
                <Pressable style={styles.categoryBackdropTapZone} onPress={closeRehabCategoryEditor} />
                <View style={[styles.timePickerCard, styles.categoryModalCard]}>
                  <Text style={styles.timePickerTitle}>Välj kategorier</Text>
                  <View style={styles.gymDialogRow}>
                    <TextInput
                      value={rehabCategoryCustomInput}
                      onChangeText={setRehabCategoryCustomInput}
                      style={[styles.input, styles.gymDialogInput]}
                      placeholder="Egen kategori"
                      placeholderTextColor={PLACEHOLDER_COLOR}
                    />
                    <Button mode="contained-tonal" onPress={addRehabCustomCategory}>
                      Lägg till
                    </Button>
                  </View>
                  <Text style={styles.categoryHintText}>Välj en eller flera kategorier</Text>
                  <ScrollView style={styles.categoryDialogList} contentContainerStyle={styles.categoryChipListContent}>
                    <View style={styles.chipWrap}>
                      {rehabCategoryChoices.map((tag) => (
                        <Pressable
                          key={`rehab-category-${tag}`}
                          style={[styles.chip, rehabCategoryDraftTags.includes(tag) && styles.chipActive]}
                          onPress={() => toggleRehabCategoryDraft(tag)}
                        >
                          <Text style={[styles.chipText, rehabCategoryDraftTags.includes(tag) && styles.chipTextActive]}>{tag}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                  <View style={styles.timePickerActions}>
                    <Button onPress={closeRehabCategoryEditor}>Avbryt</Button>
                    <Button onPress={saveRehabCategoryEditor}>Spara</Button>
                  </View>
                </View>
              </View>
            )}
          </View>
        </Modal>

        <Modal visible={!!wizardExercise} transparent animationType="slide" onRequestClose={resetWizard}>
          <View style={styles.bottomSheetBackdrop}>
            <Pressable style={styles.backdropTapZone} onPress={resetWizard} />
            <View style={styles.bottomSheet}>
              <View style={styles.bottomSheetHandle} />
              <Text style={styles.bottomSheetTitle}>
                {wizardMode === 'edit' ? 'Redigera plan' : 'Skapa plan'}: {wizardExercise?.name}
              </Text>
              <Text style={styles.wizardStepLabel}>Steg {wizardStep + 1} av 3</Text>
              {wizardStep === 0 ? (
                <View style={styles.wizardBlock}>
                  <Text style={styles.wizardSectionTitle}>1) Välj dagar</Text>
                  <View style={styles.chipWrap}>
                    {WEEKDAY_CHIPS.map((day) => {
                      const active = wizardDays.includes(day.key);
                      return (
                        <Pressable
                          key={day.key}
                          style={[styles.chip, active && styles.chipActive]}
                          onPress={() =>
                            setWizardDays((prev) =>
                              prev.includes(day.key) ? prev.filter((item) => item !== day.key) : [...prev, day.key],
                            )
                          }
                        >
                          <Text style={[styles.chipText, active && styles.chipTextActive]}>{day.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}
              {wizardStep === 1 ? (
                <View style={styles.wizardBlock}>
                  <Text style={styles.wizardSectionTitle}>2) Dosering</Text>
                  <View>
                    <Text style={styles.wizardFieldLabel}>Set</Text>
                    <View style={styles.numberStepperRow}>
                      <Pressable
                        style={styles.stepperButton}
                        onPress={() =>
                          setWizardSets((prev) => `${Math.max(1, Math.min(20, (Number.parseInt(prev, 10) || 1) - 1))}`)
                        }
                      >
                        <Text style={styles.stepperButtonText}>-</Text>
                      </Pressable>
                      <View style={styles.stepperValueBox}>
                        <Text style={styles.stepperValueText}>{Math.max(1, Number.parseInt(wizardSets, 10) || 1)}</Text>
                      </View>
                      <Pressable
                        style={styles.stepperButton}
                        onPress={() =>
                          setWizardSets((prev) => `${Math.max(1, Math.min(20, (Number.parseInt(prev, 10) || 1) + 1))}`)
                        }
                      >
                        <Text style={styles.stepperButtonText}>+</Text>
                      </Pressable>
                    </View>
                  </View>
                  <View>
                    <Text style={styles.wizardFieldLabel}>Reps</Text>
                    <View style={styles.numberStepperRow}>
                      <Pressable
                        style={styles.stepperButton}
                        onPress={() =>
                          setWizardReps((prev) => `${Math.max(1, Math.min(50, (Number.parseInt(prev, 10) || 1) - 1))}`)
                        }
                      >
                        <Text style={styles.stepperButtonText}>-</Text>
                      </Pressable>
                      <View style={styles.stepperValueBox}>
                        <Text style={styles.stepperValueText}>{Math.max(1, Number.parseInt(wizardReps, 10) || 1)}</Text>
                      </View>
                      <Pressable
                        style={styles.stepperButton}
                        onPress={() =>
                          setWizardReps((prev) => `${Math.max(1, Math.min(50, (Number.parseInt(prev, 10) || 1) + 1))}`)
                        }
                      >
                        <Text style={styles.stepperButtonText}>+</Text>
                      </Pressable>
                    </View>
                  </View>
                  <View>
                    <Text style={styles.wizardFieldLabel}>Vikt (kg, valfritt)</Text>
                    <View style={styles.numberStepperRow}>
                      <Pressable
                        style={styles.stepperButton}
                        onPress={() =>
                          setWizardWeight((prev) => {
                            const current = Number.parseFloat(prev);
                            const next = Math.max(0, (Number.isFinite(current) ? current : 0) - 0.5);
                            return next === 0 ? '' : next.toFixed(1);
                          })
                        }
                      >
                        <Text style={styles.stepperButtonText}>-</Text>
                      </Pressable>
                      <View style={styles.stepperValueBox}>
                        <Text style={styles.stepperValueText}>
                          {Number.isFinite(Number.parseFloat(wizardWeight))
                            ? `${Number.parseFloat(wizardWeight).toFixed(1)} kg`
                            : 'Ingen vikt'}
                        </Text>
                      </View>
                      <Pressable
                        style={styles.stepperButton}
                        onPress={() =>
                          setWizardWeight((prev) => {
                            const current = Number.parseFloat(prev);
                            const next = Math.min(300, (Number.isFinite(current) ? current : 0) + 0.5);
                            return next.toFixed(1);
                          })
                        }
                      >
                        <Text style={styles.stepperButtonText}>+</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              ) : null}
              {wizardStep === 2 ? (
                <View style={styles.wizardBlock}>
                  <Text style={styles.wizardSectionTitle}>3) Tider / frekvens</Text>
                  <View>
                    <Text style={styles.wizardFieldLabel}>Antal gånger per dag</Text>
                    <View style={styles.numberStepperRow}>
                      <Pressable
                        style={styles.stepperButton}
                        onPress={() =>
                          setWizardTimesPerDay((prev) =>
                            `${Math.max(1, Math.min(6, (Number.parseInt(prev, 10) || 1) - 1))}`,
                          )
                        }
                      >
                        <Text style={styles.stepperButtonText}>-</Text>
                      </Pressable>
                      <View style={styles.stepperValueBox}>
                        <Text style={styles.stepperValueText}>{Math.max(1, Number.parseInt(wizardTimesPerDay, 10) || 1)}</Text>
                      </View>
                      <Pressable
                        style={styles.stepperButton}
                        onPress={() =>
                          setWizardTimesPerDay((prev) =>
                            `${Math.max(1, Math.min(6, (Number.parseInt(prev, 10) || 1) + 1))}`,
                          )
                        }
                      >
                        <Text style={styles.stepperButtonText}>+</Text>
                      </Pressable>
                    </View>
                  </View>
                  <View style={styles.chipWrap}>
                    {wizardTimes.map((time, index) => (
                      <Pressable
                        key={`time-${index}`}
                        style={[styles.chip, styles.timeChip]}
                        onPress={() => {
                          const parsed = parseClock(time);
                          setTimeDraftHour(parsed.getHours());
                          setTimeDraftMinute(parsed.getMinutes());
                          setTimePickerIndex(index);
                        }}
                      >
                        <Text style={styles.chipText}>{`Tid ${index + 1}: ${time}`}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
              <View style={styles.wizardActions}>
                <Button onPress={resetWizard}>Avbryt</Button>
                {wizardStep > 0 ? <Button onPress={() => setWizardStep((prev) => prev - 1)}>Tillbaka</Button> : null}
                {wizardStep < 2 ? (
                  <Button mode="contained" onPress={() => setWizardStep((prev) => prev + 1)}>Nästa</Button>
                ) : (
                  <Button
                    mode="contained"
                    onPress={() => {
                      if (!wizardExercise) return;
                      const sets = Math.max(1, Number.parseInt(wizardSets, 10) || 1);
                      const reps = Math.max(1, Number.parseInt(wizardReps, 10) || 1);
                      const weight = Number.parseFloat(wizardWeight);
                      const activeDays: WeekdayKey[] = wizardDays.length === 0 ? ['mon'] : wizardDays;
                      const daysLabel = activeDays.length === 7 ? 'Varje dag' : activeDays.map((day) => WEEKDAY_LABEL_BY_KEY[day]).join(', ');
                      const nextExercisePatch = {
                        title: wizardExercise.name,
                        description: `Kroppsdelar: ${wizardExercise.tags.join(', ')}`,
                        sets,
                        reps,
                        weightKg: Number.isFinite(weight) && weight > 0 ? weight : undefined,
                        daysLabel,
                        times: wizardTimes.map((time) => time.trim()).filter(Boolean),
                        remindersOn: true,
                      };
                      if (wizardMode === 'edit' && wizardExerciseId) {
                        setExercises((prev) => prev.map((item) => (item.id === wizardExerciseId ? { ...item, ...nextExercisePatch } : item)));
                        resetWizard();
                        return;
                      }
                      const idx = exercises.length % SERIES_COLORS.length;
                      setExercises((prev) => [...prev, { id: `${Date.now()}`, ...nextExercisePatch, color: SERIES_COLORS[idx] }]);
                      resetWizard();
                    }}
                  >
                    {wizardMode === 'edit' ? 'Spara ändringar' : 'Spara plan'}
                  </Button>
                )}
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={timePickerIndex !== null} transparent animationType="fade" onRequestClose={closeTimePicker}>
          <View style={styles.timePickerBackdrop}>
            <Pressable style={styles.backdropTapZone} onPress={closeTimePicker} />
            <View style={styles.timePickerCard}>
              <Text style={styles.timePickerTitle}>
                {timePickerIndex !== null ? `Välj tid ${timePickerIndex + 1}` : 'Välj tid'}
              </Text>
              <View style={styles.timePickerStepRow}>
                <Text style={styles.wizardFieldLabel}>Timme</Text>
                <View style={styles.numberStepperRow}>
                  <Pressable style={styles.stepperButton} onPress={() => setTimeDraftHour((prev) => (prev - 1 + 24) % 24)}>
                    <Text style={styles.stepperButtonText}>-</Text>
                  </Pressable>
                  <View style={styles.stepperValueBox}>
                    <Text style={styles.stepperValueText}>{String(timeDraftHour).padStart(2, '0')}</Text>
                  </View>
                  <Pressable style={styles.stepperButton} onPress={() => setTimeDraftHour((prev) => (prev + 1) % 24)}>
                    <Text style={styles.stepperButtonText}>+</Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.timePickerStepRow}>
                <Text style={styles.wizardFieldLabel}>Minut</Text>
                <View style={styles.numberStepperRow}>
                  <Pressable style={styles.stepperButton} onPress={() => setTimeDraftMinute((prev) => (prev - 5 + 60) % 60)}>
                    <Text style={styles.stepperButtonText}>-</Text>
                  </Pressable>
                  <View style={styles.stepperValueBox}>
                    <Text style={styles.stepperValueText}>{String(timeDraftMinute).padStart(2, '0')}</Text>
                  </View>
                  <Pressable style={styles.stepperButton} onPress={() => setTimeDraftMinute((prev) => (prev + 5) % 60)}>
                    <Text style={styles.stepperButtonText}>+</Text>
                  </Pressable>
                </View>
              </View>
              <Text style={styles.timePreviewText}>
                Vald tid: {String(timeDraftHour).padStart(2, '0')}:{String(timeDraftMinute).padStart(2, '0')}
              </Text>
              <View style={styles.timePickerActions}>
                <Button onPress={closeTimePicker}>Avbryt</Button>
                <Button
                  mode="contained"
                  onPress={() => {
                    if (timePickerIndex === null) return;
                    setWizardTimes((prev) =>
                      prev.map((time, idx) =>
                        idx === timePickerIndex
                          ? `${String(timeDraftHour).padStart(2, '0')}:${String(timeDraftMinute).padStart(2, '0')}`
                          : time,
                      ),
                    );
                    closeTimePicker();
                  }}
                >
                  Spara
                </Button>
              </View>
            </View>
          </View>
        </Modal>

        <Portal>
          <Dialog visible={!!deleteDialogExercise} onDismiss={() => setDeleteDialogExercise(null)}>
            <Dialog.Title>Ta bort övning</Dialog.Title>
            <Dialog.Content>
              <Text style={styles.deleteDialogText}>Säker på att du vill ta bort "{deleteDialogExercise?.title}"?</Text>
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => setDeleteDialogExercise(null)}>Avbryt</Button>
              <Button
                textColor="#EF9A9A"
                onPress={() => {
                  if (!deleteDialogExercise) return;
                  setExercises((prev) => prev.filter((item) => item.id !== deleteDialogExercise.id));
                  setDeleteDialogExercise(null);
                }}
              >
                Ta bort
              </Button>
            </Dialog.Actions>
          </Dialog>

          <Dialog visible={newSeriesDialog} onDismiss={() => setNewSeriesDialog(false)}>
            <Dialog.Title>Var har du ont?</Dialog.Title>
            <Dialog.Content>
              <TextInput
                value={newSeriesName}
                onChangeText={setNewSeriesName}
                style={styles.input}
                placeholder="Ex. Höger axel"
                placeholderTextColor={PLACEHOLDER_COLOR}
              />
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => setNewSeriesDialog(false)}>Avbryt</Button>
              <Button
                onPress={() => {
                  if (!newSeriesName.trim()) return;
                  setPainSeries((prev) => [...prev, { id: `${Date.now()}`, name: newSeriesName.trim(), value: 5, draftNote: '', entries: [] }]);
                  setNewSeriesName('');
                  setNewSeriesDialog(false);
                }}
              >
                Lägg till
              </Button>
            </Dialog.Actions>
          </Dialog>

        </Portal>
      </PaperProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0F1419' },
  listContent: { padding: 12, gap: 12, paddingBottom: 120 },
  exerciseCard: {
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 1,
    borderColor: '#253545',
    borderLeftWidth: 7,
  },
  exerciseMain: { flex: 1 },
  exerciseTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  exerciseMeta: { color: '#fff', fontSize: 13, marginTop: 2 },
  timeRow: { marginTop: 2 },
  exerciseRight: { alignItems: 'center', justifyContent: 'center' },
  reminderLabel: { color: '#fff', fontWeight: '600', marginBottom: 3 },
  weightButton: { marginTop: 8, backgroundColor: '#C8E6C9', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#DCE4EC', textAlign: 'center' },
  emptySubtitle: { marginTop: 6, fontSize: 15, color: '#9AAEC0', textAlign: 'center' },
  fab: { position: 'absolute', right: 16, bottom: 22 },
  swipeActions: { justifyContent: 'center', marginBottom: 8 },
  swipeActionsLeft: { paddingRight: 8 },
  swipeActionsRight: { paddingLeft: 8 },
  swipeButton: {
    minWidth: 86,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  swipeButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  editButton: { backgroundColor: '#42A5F5' },
  deleteButton: { backgroundColor: '#EF5350' },
  input: { borderWidth: 1, borderColor: '#33414F', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#1A222C', color: '#E3EAF2' },
  bottomSheetBackdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.55)', justifyContent: 'flex-end' },
  backdropTapZone: { flex: 1 },
  bottomSheet: {
    maxHeight: '88%',
    minHeight: '58%',
    backgroundColor: '#151D26',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: '#24313E',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 16,
  },
  gymBottomSheet: {
    minHeight: '100%',
    maxHeight: '100%',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    paddingTop: 0,
  },
  libraryBottomSheet: {
    minHeight: '100%',
    maxHeight: '100%',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    paddingTop: 0,
  },
  // (gymAnimatedSheet removed – renderToHardwareTextureAndroid moved to prop)
  librarySheetContent: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 80 : 50,
  },
  libraryDragZone: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: Platform.OS === 'ios' ? 80 : 50,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 8,
    zIndex: 20,
  },
  gymSheetContent: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 80 : 50,
  },
  gymDragZone: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: Platform.OS === 'ios' ? 80 : 50,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 8,
    zIndex: 20,
  },
  bottomSheetHandle: {
    width: 56,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#8899AA',
    alignSelf: 'center',
    marginBottom: 10,
  },
  bottomSheetTitle: { color: '#E3EAF2', fontSize: 20, fontWeight: '700' },
  librarySearch: { marginTop: 10 },
  filterRow: { marginTop: 10, flexGrow: 0 },
  filterRowContent: { paddingVertical: 8, gap: 8, paddingRight: 12, alignItems: 'center' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#42515F',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#1A222C',
  },
  gymFilterChip: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 46,
    justifyContent: 'center',
    backgroundColor: '#1D2732',
    borderColor: '#5A6B7B',
  },
  gymFilterChipActive: { borderColor: '#7BCF9A' },
  chipActive: { backgroundColor: '#2D7A49', borderColor: '#53A772' },
  chipText: { color: '#E3EAF2', fontWeight: '600', lineHeight: 20, fontSize: 14 },
  gymFilterChipText: { color: '#F2F7FC', fontSize: 15, fontWeight: '700', lineHeight: 22 },
  chipTextActive: { color: '#EAF8F0' },
  libraryList: { gap: 10, paddingTop: 12, paddingBottom: 20, flexGrow: 1 },
  libraryItem: {
    borderWidth: 1,
    borderColor: '#273644',
    borderRadius: 12,
    backgroundColor: '#1A222C',
    padding: 10,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  libraryItemMain: { flex: 1, gap: 8 },
  libraryName: { color: '#E3EAF2', fontSize: 16, fontWeight: '700' },
  libraryTagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  libraryTag: { borderRadius: 999, backgroundColor: '#2B3A48', paddingHorizontal: 11, paddingVertical: 6 },
  libraryTagText: { color: '#D3E7F8', fontSize: 13, fontWeight: '700' },
  wizardStepLabel: { marginTop: 2, color: '#8FA1B3' },
  wizardBlock: { marginTop: 12, gap: 10 },
  wizardSectionTitle: { color: '#DCE4EC', fontSize: 16, fontWeight: '700' },
  wizardFieldLabel: { color: '#A8BACB', fontSize: 13 },
  numberStepperRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperButton: {
    width: 42,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#42515F',
    backgroundColor: '#1A222C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonText: { color: '#E3EAF2', fontSize: 24, fontWeight: '700', marginTop: -2 },
  stepperValueBox: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#33414F',
    backgroundColor: '#1A222C',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  stepperValueText: { color: '#E3EAF2', fontSize: 16, fontWeight: '700' },
  timeChip: { minWidth: 132 },
  wizardActions: { marginTop: 14, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  timePickerBackdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.62)', justifyContent: 'center', paddingHorizontal: 18 },
  timePickerCard: {
    backgroundColor: '#151D26',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2B3A48',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  timePickerTitle: { color: '#E3EAF2', fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  timePickerStepRow: { gap: 6, marginBottom: 8 },
  timePreviewText: { color: '#9EC0DC', textAlign: 'center', fontSize: 14, fontWeight: '600', marginTop: 4 },
  timePickerActions: { marginTop: 4, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  deleteDialogText: { color: '#DCE4EC', fontSize: 15, lineHeight: 22 },
  dropdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 10 },
  dropdownHint: { color: '#9AAEC0' },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 8 },
  dropdownText: { flex: 1, fontSize: 15, color: '#DCE4EC' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  chartCard: { marginHorizontal: 12, marginTop: 8, backgroundColor: '#151D26', borderRadius: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#24313E' },
  monthTitle: { marginTop: 10, textAlign: 'center', fontSize: 22, fontWeight: '700', color: '#DCE4EC' },
  diaryChartHeader: { marginTop: 10, marginHorizontal: 12, minHeight: 40, justifyContent: 'center', position: 'relative' },
  diaryMonthTitle: { marginTop: 0, textAlign: 'center' },
  diaryViewButtonWrap: { position: 'absolute', right: 0 },
  axisRow: { flexDirection: 'row', width: DAY_WIDTH * 68 },
  axisDay: { width: DAY_WIDTH, alignItems: 'center', paddingVertical: 2 },
  axisWeek: { fontSize: 12, color: '#8FA1B3' },
  axisDate: { fontSize: 11, color: '#8FA1B3' },
  todayText: { fontWeight: '700', color: '#7FC8FF' },
  diaryChartCanvas: { height: 230, position: 'relative' },
  diaryPointOverlay: { ...StyleSheet.absoluteFillObject },
  diaryPointHitbox: { position: 'absolute', width: 24, height: 24, borderRadius: 12 },
  diaryAxisRow: { height: 40, position: 'relative' },
  diaryAxisItem: { position: 'absolute', alignItems: 'center' },
  diaryAxisDate: { fontSize: 11, color: '#9DB0C2' },
  diaryAxisTime: { fontSize: 11, color: '#7FC8FF', fontWeight: '600' },
  seriesCard: { backgroundColor: '#151D26', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#24313E' },
  activeSeriesCard: { borderWidth: 1.5, borderColor: '#7FC8FF' },
  seriesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  seriesTitle: { fontSize: 18, fontWeight: '700', color: '#DCE4EC' },
  badge: { alignSelf: 'flex-start', backgroundColor: '#C8E6C9', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, marginTop: 8 },
  badgeText: { fontWeight: '700', color: '#2E7D32' },
  noteInput: { minHeight: 54, marginTop: 8, textAlignVertical: 'top' },
  seriesButtons: { marginTop: 8, flexDirection: 'row', gap: 8 },
  logWrap: { marginTop: 10, gap: 8, paddingBottom: 40 },
  logEmpty: { color: '#8FA1B3', textAlign: 'center' },
  logRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 8, borderRadius: 8 },
  logRowActive: { backgroundColor: '#1D2A36', borderWidth: 1, borderColor: '#7FC8FF' },
  logTextWrap: { flex: 1 },
  logTime: { fontSize: 12, color: '#8FA1B3' },
  logNote: { fontSize: 14, color: '#DCE4EC' },
  logNoteActive: { fontWeight: '700', color: '#7FC8FF' },
  trainingCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#24313E',
    backgroundColor: '#151D26',
    padding: 12,
    gap: 8,
  },
  trainingHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  trainingHeaderActions: { flexDirection: 'row', gap: 12 },
  trainingTitle: { color: '#E3EAF2', fontSize: 18, fontWeight: '700' },
  trainingHomeButtonsRow: { flexDirection: 'row', gap: 8 },
  trainingHomeButton: { flex: 1 },
  trainingHomeButtonContent: { minHeight: 52 },
  trainingPrimaryAction: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#67AF86',
    backgroundColor: '#234436',
    paddingVertical: 16,
    paddingHorizontal: 14,
    gap: 6,
  },
  trainingPrimaryTitle: { color: '#E6F6EC', fontWeight: '800', fontSize: 20, textAlign: 'center' },
  trainingPrimarySubtitle: { color: '#C9EAD7', fontSize: 13, textAlign: 'center' },
  ongoingWorkoutButton: {
    borderColor: '#58BA82',
    backgroundColor: '#214933',
  },
  ongoingWorkoutText: { color: '#CFF3D9', fontWeight: '800', textAlign: 'center', fontSize: 14 },
  trainingSectionTitle: { color: '#DCE4EC', fontSize: 16, fontWeight: '700', marginTop: 6 },
  historyHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  historySelectionActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  historySelectedCount: { color: '#DCE4EC', fontSize: 16, fontWeight: '700', minWidth: 14, textAlign: 'right' },
  historyTrashButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EF9A9A',
    borderWidth: 1,
    borderColor: '#D17F7F',
  },
  historySelectedCard: { borderColor: '#7FC8FF', backgroundColor: '#1B2A38' },
  historyCardContent: { gap: 3 },
  historyCardTitle: { color: '#EAF2FA', fontSize: 19, fontWeight: '800' },
  historyCardDateTime: { color: '#B8C8D7', fontSize: 13, fontWeight: '600' },
  historyCardDuration: { color: '#96ADC1', fontSize: 12, fontWeight: '600' },
  historyDetailMeta: { color: '#A8BACB', fontSize: 12, marginTop: 4, textAlign: 'center' },
  historySetRow: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2C3A49',
    backgroundColor: '#16202B',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  historySetValue: { color: '#B9CAD9', fontSize: 13, fontWeight: '700' },
  trainingSessionTop: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, minHeight: 46, justifyContent: 'center' },
  trainingBackButton: { position: 'absolute', left: 12, top: 10, flexDirection: 'row', alignItems: 'center', gap: 4, zIndex: 5, elevation: 5 },
  sectionBackText: { color: '#DCE4EC', fontSize: 14, fontWeight: '600' },
  trainingTimer: { color: '#E3EAF2', fontSize: 24, fontWeight: '800', textAlign: 'center' },
  trainingStatActions: { flexDirection: 'row', gap: 6, marginTop: 6 },
  trainingStatButton: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#445361',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#101821',
  },
  trainingStatButtonText: { color: '#DCE4EC', fontSize: 16, fontWeight: '700', marginTop: -1 },
  trainingMeta: { color: '#A8BACB', fontSize: 13, marginTop: 2 },
  loggedSetList: { gap: 6, marginTop: 2 },
  loggedSetEmpty: { color: '#8FA1B3', fontSize: 13 },
  loggedSetRow: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2C3A49',
    backgroundColor: '#16202B',
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  loggedSetTitle: { color: '#DCE4EC', fontWeight: '700', minWidth: 48 },
  loggedSetMetrics: { alignItems: 'center', minWidth: 108 },
  loggedSetMetricLabel: { color: '#8FA1B3', fontSize: 11, textTransform: 'uppercase' },
  loggedSetMetricValue: { color: '#A8BACB', fontSize: 13, fontWeight: '700' },
  trainingBottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  trainingLastLogged: { color: '#8FA1B3', fontSize: 12 },
  trainingButtons: { flexDirection: 'row', gap: 8 },
  savedPlanActionsRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  savedPlanActionButton: { flex: 1 },
  trainingBuilderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sessionBottomActions: {
    marginHorizontal: 12,
    marginBottom: 22,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  sessionNavButton: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#A5D6A7',
    borderWidth: 1,
    borderColor: '#7FBF82',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionFinishButton: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#81C784',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  sessionFinishButtonText: { color: '#0F1419', fontWeight: '800', fontSize: 15, textAlign: 'center' },
  sessionPlusButton: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#A5D6A7',
    borderWidth: 1,
    borderColor: '#7FBF82',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionPlusButtonText: { color: '#0F1419', fontWeight: '800', fontSize: 28, marginTop: -2 },
  gymDialogContent: { gap: 10 },
  gymDialogRow: { flexDirection: 'row', gap: 8 },
  gymDialogInput: { flex: 1 },
  categoryDialogList: { maxHeight: 280, marginTop: 10 },
  categoryChipListContent: { paddingVertical: 6, paddingBottom: 10 },
  categoryModalCard: { width: '100%', maxWidth: 420, alignSelf: 'center', minHeight: 430, paddingBottom: 12, zIndex: 2, elevation: 2 },
  categoryBackdropTapZone: { ...StyleSheet.absoluteFillObject, zIndex: 1 },
  categoryEditorOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.62)', justifyContent: 'center', paddingHorizontal: 18, zIndex: 50, elevation: 50 },
  categoryHintText: { color: '#9AAEC0', marginTop: 20, marginBottom: 2 },
});
