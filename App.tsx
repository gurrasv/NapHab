import 'react-native-gesture-handler';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { DarkTheme as NavigationDarkTheme, NavigationContainer, useFocusEffect } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Gesture, GestureDetector, GestureHandlerRootView, ScrollView, Swipeable } from 'react-native-gesture-handler';
import * as Device from 'expo-device';
import {
  consumeAndroidPendingCompletions,
  dismissAndroidWorkoutNotification,
  ensureAndroidExactAlarmPermission,
  requestAndroidNotificationPermission,
  scheduleAndroidNotifications,
  showAndroidWorkoutNotification,
  type AndroidNotificationSchedule,
} from './notifications/androidNativeNotifications';
import { buildUpcomingScheduleOccurrences } from './notifications/schedulerEngine';
import {
  Alert,
  Animated,
  AppState,
  BackHandler,
  Dimensions,
  Easing,
  FlatList,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView as RNScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button, Checkbox, Dialog, MD3DarkTheme, Portal, Provider as PaperProvider } from 'react-native-paper';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

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
  libraryExerciseId?: string;
  name: string;
  sets: SessionSet[];
};
type WorkoutPlanExercise = { id: string; libraryExerciseId?: string; name: string; sets: number; reps: number; repsPerSet?: number[] };
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
type ExerciseWeightPb = {
  exerciseId: string;
  weightKey: number;
  bestReps: number;
  date: string;
};
type PbSortMode = 'reps_desc' | 'reps_asc' | 'weight_desc' | 'weight_asc' | 'date_desc';
type PersistedState = {
  exercises: Exercise[];
  logs: ExerciseLog[];
  painSeries: PainSeries[];
  workoutPlans?: WorkoutPlan[];
  completedWorkouts?: CompletedWorkout[];
  exerciseWeightPbs?: ExerciseWeightPb[];
  rehabLibraryExercises?: LibraryExercise[];
  gymLibraryExercises?: LibraryExercise[];
};
type DiaryViewMode = 'tim' | 'dag' | 'manad';
type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
type LibraryExercise = { id: string; name: string; tags: string[] };
type WizardMode = 'create' | 'edit';

const Tab = createBottomTabNavigator();

type TabTransitionDirection = 'left' | 'right' | null;
const TabTransitionContext = createContext<{
  direction: TabTransitionDirection;
  clearDirection: () => void;
}>({ direction: null, clearDirection: () => {} });

const TAB_SWIPE_DURATION_MS = 180;
const TAB_SWIPE_DISTANCE_RATIO = 0.05;
const APP_BG_COLOR = '#0F1419';
const CARD_TRANSITION_CORNER_RADIUS = 16;
const MIN_CARD_TRANSITION_SCALE = 0.2;

function AnimatedTabScreen({ children }: { children: React.ReactNode }) {
  const { direction, clearDirection } = useContext(TabTransitionContext);
  const translateX = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      if (direction === null) {
        translateX.setValue(0);
        return;
      }
      const { width } = Dimensions.get('window');
      const fromX = direction === 'right' ? width * TAB_SWIPE_DISTANCE_RATIO : -width * TAB_SWIPE_DISTANCE_RATIO;
      translateX.setValue(fromX);
      Animated.timing(translateX, {
        toValue: 0,
        duration: TAB_SWIPE_DURATION_MS,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }).start(() => clearDirection());
    }, [direction, clearDirection, translateX])
  );

  return (
    <Animated.View style={{ flex: 1, backgroundColor: APP_BG_COLOR, transform: [{ translateX }] }}>
      {children}
    </Animated.View>
  );
}

const DAY_WIDTH = 52;
const STORAGE_KEY = 'naphab_state_v1';
const SERIES_COLORS = [
  '#5E81AC', '#A3BE8C', '#EBCB8B', '#BF616A', '#B48EAD',
  '#88C0D0', '#D08770', '#81A1C1', '#8FBCBB', '#E5C07B',
];
const DAY_COLORS = ['#5E81AC', '#A3BE8C', '#EBCB8B', '#B48EAD', '#88C0D0', '#D08770', '#81A1C1'];
const PLACEHOLDER_COLOR = '#8FA1B3';
const WEIGHT_KEY_FACTOR = 2; // 0.5 kg increments
const ENTRY_SPACING = 70;
const CHART_SIDE_PADDING = 28;
const DIARY_VIEW_ORDER: DiaryViewMode[] = ['tim', 'dag', 'manad'];
const PB_SORT_ORDER: PbSortMode[] = ['reps_desc', 'reps_asc', 'weight_desc', 'weight_asc', 'date_desc'];
const DIARY_VIEW_CONFIG: Record<DiaryViewMode, { label: string; spanMs: number }> = {
  tim: { label: 'Tim vy', spanMs: 24 * 60 * 60 * 1000 },
  dag: { label: 'Dags vy', spanMs: 7 * 24 * 60 * 60 * 1000 },
  manad: { label: 'Månads vy', spanMs: 28 * 24 * 60 * 60 * 1000 },
};
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
const WEEKDAY_KEY_BY_JS_DAY: Record<number, WeekdayKey> = {
  0: 'sun',
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
};
const toWeightKey = (weightKg: number): number => Math.round(weightKg * WEIGHT_KEY_FACTOR);
const weightKeyToKg = (weightKey: number): number => weightKey / WEIGHT_KEY_FACTOR;
const formatWeightKg = (weightKg: number): string => (Number.isInteger(weightKg) ? `${weightKg}` : weightKg.toFixed(1));
const dominatesPbPoint = (
  a: { weightKey: number; bestReps: number },
  b: { weightKey: number; bestReps: number },
): boolean =>
  a.weightKey >= b.weightKey
  && a.bestReps >= b.bestReps
  && (a.weightKey > b.weightKey || a.bestReps > b.bestReps);
const pruneDominatedPbRows = <T extends { weightKey: number; bestReps: number }>(rows: T[]): T[] =>
  rows.filter((row, idx) => !rows.some((other, otherIdx) => otherIdx !== idx && dominatesPbPoint(other, row)));

/* ── Notification helpers ── */
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

function getTodayWeekdayKey(): WeekdayKey {
  return WEEKDAY_KEY_BY_JS_DAY[new Date().getDay()] ?? 'mon';
}

function mergeLogs(base: ExerciseLog[], incoming: ExerciseLog[]): ExerciseLog[] {
  if (incoming.length === 0) return base;
  const seen = new Set(base.map((log) => `${log.exerciseId}|${log.atIso}`));
  const out = [...base];
  incoming.forEach((log) => {
    const key = `${log.exerciseId}|${log.atIso}`;
    if (!log.exerciseId || !log.atIso || seen.has(key)) return;
    seen.add(key);
    out.push(log);
  });
  return out;
}

async function scheduleExerciseNotifications(
  exercises: Exercise[],
): Promise<void> {
  if (!Device.isDevice) return;

  const now = new Date();
  const candidates = buildUpcomingScheduleOccurrences(exercises, {
    now,
    windowDays: 30,
  });

  if (Platform.OS !== 'android') return;

  const notificationPermissionGranted = await requestAndroidNotificationPermission();
  if (!notificationPermissionGranted) return;
  // Even without exact alarm permission we still schedule with inexact fallback in native layer.
  await ensureAndroidExactAlarmPermission();

  const payloads: AndroidNotificationSchedule[] = candidates.map(({ exerciseId, title, sets, reps, scheduledTime, scheduleId }) => ({
    exerciseId,
    title,
    sets,
    reps,
    scheduledAtIso: scheduledTime.toISOString(),
    scheduleId,
  }));
  // Native side performs cancel + replace atomically, including clearing all when payloads is empty.
  await scheduleAndroidNotifications(payloads);
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
  { id: 'bench-press', name: 'Bänkpress', tags: ['Bröst', 'Triceps', 'Fria vikter'] },
  { id: 'incline-dumbbell-press', name: 'Lutande hantelpress', tags: ['Bröst', 'Axlar', 'Fria vikter'] },
  { id: 'dumbbell-press', name: 'Hantelpress', tags: ['Bröst', 'Triceps', 'Fria vikter'] },
  { id: 'dumbbell-flyes', name: 'Hantelflyes', tags: ['Bröst', 'Fria vikter'] },
  { id: 'overhead-press', name: 'Militärpress', tags: ['Axlar', 'Triceps', 'Fria vikter'] },
  { id: 'dumbbell-shoulder-press', name: 'Hantelpress axlar', tags: ['Axlar', 'Triceps', 'Fria vikter'] },
  { id: 'lateral-raise', name: 'Sidolyft', tags: ['Axlar', 'Fria vikter'] },
  { id: 'front-raise', name: 'Framlyft', tags: ['Axlar', 'Fria vikter'] },
  { id: 'face-pull', name: 'Face pull', tags: ['Axlar', 'Rygg', 'Fria vikter'] },
  { id: 'barbell-row', name: 'Skivstångsrodd', tags: ['Rygg', 'Biceps', 'Fria vikter'] },
  { id: 'deadlift', name: 'Marklyft', tags: ['Rygg', 'Ben', 'Fria vikter'] },
  { id: 'romanian-deadlift', name: 'Raka marklyft', tags: ['Baksida lår', 'Rygg', 'Fria vikter'] },
  { id: 'dumbbell-row', name: 'Hantelrodd', tags: ['Rygg', 'Biceps', 'Fria vikter'] },
  { id: 't-bar-row', name: 'T-bar rodd', tags: ['Rygg', 'Biceps', 'Fria vikter'] },
  { id: 'pull-up', name: 'Chins / Pull-up', tags: ['Rygg', 'Biceps', 'Fria vikter', 'Kroppsvikt'] },
  { id: 'squat', name: 'Knäböj', tags: ['Ben', 'Fria vikter'] },
  { id: 'goblet-squat', name: 'Goblet squat', tags: ['Ben', 'Fria vikter'] },
  { id: 'bulgarian-split-squat', name: 'Bulgariansk split squat', tags: ['Ben', 'Fria vikter'] },
  { id: 'lunges', name: 'Utfall', tags: ['Ben', 'Fria vikter', 'Kroppsvikt'] },
  { id: 'hip-thrust', name: 'Hip thrust', tags: ['Säte', 'Ben', 'Fria vikter'] },
  { id: 'calf-raise', name: 'Vadlyft', tags: ['Ben', 'Vader', 'Fria vikter'] },
  { id: 'bicep-curl', name: 'Bicepscurl', tags: ['Biceps', 'Fria vikter'] },
  { id: 'hammer-curl', name: 'Hammer curl', tags: ['Biceps', 'Underarm', 'Fria vikter'] },
  { id: 'barbell-curl', name: 'Skivstångscurl', tags: ['Biceps', 'Fria vikter'] },
  { id: 'tricep-kickback', name: 'Triceps kickback', tags: ['Triceps', 'Fria vikter'] },
  { id: 'skull-crusher', name: 'Fransk press', tags: ['Triceps', 'Fria vikter'] },
  { id: 'close-grip-bench', name: 'Smal bänkpress', tags: ['Triceps', 'Bröst', 'Fria vikter'] },
  { id: 'lat-pulldown', name: 'Latsdrag', tags: ['Rygg', 'Biceps', 'Maskin'] },
  { id: 'chest-press-machine', name: 'Bröstpress (maskin)', tags: ['Bröst', 'Triceps', 'Maskin'] },
  { id: 'pec-deck', name: 'Pec deck / Butterfly', tags: ['Bröst', 'Maskin'] },
  { id: 'cable-crossover', name: 'Cable crossover', tags: ['Bröst', 'Maskin', 'Kabel'] },
  { id: 'cable-fly', name: 'Kabel flyes', tags: ['Bröst', 'Maskin', 'Kabel'] },
  { id: 'smith-machine-press', name: 'Smith maskin press', tags: ['Axlar', 'Bröst', 'Maskin'] },
  { id: 'cable-lateral-raise', name: 'Kabel sidolyft', tags: ['Axlar', 'Maskin', 'Kabel'] },
  { id: 'cable-row', name: 'Kabelrodd', tags: ['Rygg', 'Biceps', 'Maskin', 'Kabel'] },
  { id: 'seated-cable-row', name: 'Sittande kabelrodd', tags: ['Rygg', 'Biceps', 'Maskin', 'Kabel'] },
  { id: 'straight-arm-pulldown', name: 'Raka armar latsdrag', tags: ['Rygg', 'Maskin', 'Kabel'] },
  { id: 'leg-press', name: 'Benpress', tags: ['Ben', 'Maskin'] },
  { id: 'leg-extension', name: 'Bensträckning', tags: ['Ben', 'Lår', 'Maskin'] },
  { id: 'leg-curl', name: 'Benböj', tags: ['Baksida lår', 'Ben', 'Maskin'] },
  { id: 'leg-curl-standing', name: 'Stående benböj', tags: ['Baksida lår', 'Ben', 'Maskin'] },
  { id: 'calf-raise-machine', name: 'Vadlyft (maskin)', tags: ['Ben', 'Vader', 'Maskin'] },
  { id: 'hack-squat', name: 'Hack squat', tags: ['Ben', 'Maskin'] },
  { id: 'smith-squat', name: 'Smith maskin knäböj', tags: ['Ben', 'Maskin'] },
  { id: 'tricep-pushdown', name: 'Triceps pushdown', tags: ['Triceps', 'Maskin', 'Kabel'] },
  { id: 'cable-curl', name: 'Kabelcurl', tags: ['Biceps', 'Maskin', 'Kabel'] },
  { id: 'preacher-curl', name: 'Preacher curl', tags: ['Biceps', 'Maskin'] },
  { id: 'tricep-dip-machine', name: 'Triceps dip (maskin)', tags: ['Triceps', 'Bröst', 'Maskin'] },
  { id: 'push-up', name: 'Armhävningar', tags: ['Bröst', 'Triceps', 'Kroppsvikt'] },
  { id: 'dips', name: 'Dips', tags: ['Bröst', 'Triceps', 'Kroppsvikt'] },
  { id: 'plank', name: 'Planka', tags: ['Mage', 'Kroppsvikt'] },
  { id: 'squat-bodyweight', name: 'Knäböj kroppsvikt', tags: ['Ben', 'Kroppsvikt'] },
  { id: 'mountain-climbers', name: 'Mountain climbers', tags: ['Mage', 'Ben', 'Kroppsvikt'] },
  { id: 'glute-bridge', name: 'Skattskyffel', tags: ['Säte', 'Ben', 'Kroppsvikt'] },
];
const GYM_EQUIPMENT_TAGS: string[] = ['Fria vikter', 'Maskin', 'Kroppsvikt', 'Kabel'];
const GYM_EQUIPMENT_SET = new Set(GYM_EQUIPMENT_TAGS);

/** Merges persisted gym library with default list: default exercises always included (new in app updates), user tag edits from persisted kept, custom exercises (Egen / gym-custom-*) appended. */
function mergeGymLibrary(persisted: LibraryExercise[]): LibraryExercise[] {
  const persistedById = new Map(persisted.map((e) => [e.id, e]));
  const defaultIds = new Set(GYM_LIBRARY_EXERCISES.map((e) => e.id));
  const result: LibraryExercise[] = [];
  for (const def of GYM_LIBRARY_EXERCISES) {
    result.push(persistedById.get(def.id) ?? def);
  }
  for (const p of persisted) {
    if (defaultIds.has(p.id)) continue;
    if (p.id.startsWith('gym-custom-') || p.tags.includes('Egen')) {
      result.push(p);
    }
  }
  return result;
}

const swedishWeekday = (date: Date) =>
  new Intl.DateTimeFormat('sv-SE', { weekday: 'short' }).format(date).replace('.', '');
const formatDateKey = (date: Date) => date.toISOString().slice(0, 10);
/** YYYY-MM-DD in local timezone (for grouping logs by calendar day, not UTC). */
const formatDateKeyLocal = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

const stripSeedEntries = (entries: PainEntry[], tag: string): PainEntry[] =>
  entries.filter(
    (entry) => !entry.id.startsWith(`${tag}-m-`) && !entry.id.startsWith(`${tag}-e-`),
  );

function HomeScreen({
  exercises,
  setExercises,
  onQuickLog,
  onEditExercise,
  onDeleteExercise,
}: {
  exercises: Exercise[];
  setExercises: React.Dispatch<React.SetStateAction<Exercise[]>>;
  onQuickLog: (exerciseId: string) => void;
  onEditExercise: (exercise: Exercise) => void;
  onDeleteExercise: (exercise: Exercise) => void;
}) {
  const insets = useSafeAreaInsets();
  const swipeableRefs = useRef(new Map<string, Swipeable | null>());
  const openSwipeIdRef = useRef<string | null>(null);

  const updateExercise = (id: string, patch: Partial<Exercise>) =>
    setExercises((prev) => prev.map((exercise) => (exercise.id === id ? { ...exercise, ...patch } : exercise)));

  const closeAllSwipes = useCallback((exceptId?: string) => {
    swipeableRefs.current.forEach((instance, id) => {
      if (id !== exceptId) instance?.close();
    });
    if (!exceptId || openSwipeIdRef.current !== exceptId) {
      openSwipeIdRef.current = null;
    }
  }, []);

  const onCardPress = useCallback((exerciseId: string) => {
    if (openSwipeIdRef.current && openSwipeIdRef.current !== exerciseId) {
      closeAllSwipes(exerciseId);
    }
  }, [closeAllSwipes]);

  const onEditFromSwipe = useCallback((exercise: Exercise) => {
    closeAllSwipes();
    onEditExercise(exercise);
  }, [closeAllSwipes, onEditExercise]);

  const onDeleteFromSwipe = useCallback((exercise: Exercise) => {
    closeAllSwipes();
    onDeleteExercise(exercise);
  }, [closeAllSwipes, onDeleteExercise]);

  useFocusEffect(
    useCallback(() => () => closeAllSwipes(), [closeAllSwipes]),
  );

  const runMinimalTriggerTest = async () => {
    try {
      if (!(await requestAndroidNotificationPermission())) {
        Alert.alert('Test misslyckades', 'Notisbehörighet nekad.');
        return;
      }
      if (!(await ensureAndroidExactAlarmPermission())) return;
      const triggerAt = new Date(Date.now() + 60 * 1000);
      const count = await scheduleAndroidNotifications([
        {
          exerciseId: 'manual-test',
          title: 'Manuell testövning',
          sets: 1,
          reps: 1,
          scheduledAtIso: triggerAt.toISOString(),
          scheduleId: `manual-test-${triggerAt.getTime()}`,
        },
      ]);
      Alert.alert(
        'Android native test schemalagd',
        `Notis om ca 60 sek.\nSchemalagda poster: ${count}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Test misslyckades', `Android native test felade: ${msg}`);
    }
  };

  const runInstantNotificationTest = async () => {
    try {
      if (!(await requestAndroidNotificationPermission())) {
        Alert.alert('Test misslyckades', 'Notisbehörighet nekad.');
        return;
      }
      if (!(await ensureAndroidExactAlarmPermission())) return;
      const triggerAt = new Date(Date.now() + 5 * 1000);
      const count = await scheduleAndroidNotifications([
        {
          exerciseId: 'manual-test-now',
          title: 'Manuell testövning',
          sets: 1,
          reps: 1,
          scheduledAtIso: triggerAt.toISOString(),
          scheduleId: `manual-now-${triggerAt.getTime()}`,
        },
      ]);
      Alert.alert(
        'Android native test (snabb)',
        `Notis om ca 5 sek.\nSchemalagda poster: ${count}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Test misslyckades', `Android native test felade: ${msg}`);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>  
      <Text style={styles.screenTitle}>TrackWell</Text>
      {__DEV__ && (
        <>
          <Pressable onPress={runInstantNotificationTest} style={styles.minimalTriggerTestButton}>
            <Text style={styles.minimalTriggerTestText}>Skicka testnotis nu</Text>
          </Pressable>
          <Pressable onPress={runMinimalTriggerTest} style={styles.minimalTriggerTestButton}>
            <Text style={styles.minimalTriggerTestText}>Test 60s trigger</Text>
          </Pressable>
        </>
      )}
      {exercises.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Inga övningar ännu</Text>
          <Text style={styles.emptySubtitle}>Tryck på ＋ för att lägga till din första övning</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent} onTouchEnd={() => closeAllSwipes()}>
          {exercises.map((exercise) => (
            <Swipeable
              key={exercise.id}
              ref={(instance) => {
                if (instance) {
                  swipeableRefs.current.set(exercise.id, instance);
                  return;
                }
                swipeableRefs.current.delete(exercise.id);
              }}
              overshootLeft={false}
              overshootRight={false}
              onSwipeableWillOpen={() => {
                openSwipeIdRef.current = exercise.id;
                closeAllSwipes(exercise.id);
              }}
              onSwipeableOpen={() => {
                openSwipeIdRef.current = exercise.id;
                closeAllSwipes(exercise.id);
              }}
              onSwipeableClose={() => {
                if (openSwipeIdRef.current === exercise.id) {
                  openSwipeIdRef.current = null;
                }
              }}
              renderLeftActions={() => (
                <View style={[styles.swipeActions, styles.swipeActionsLeft]}>
                  <Pressable style={[styles.swipeButton, styles.editButton]} onPress={() => onEditFromSwipe(exercise)}>
                    <MaterialIcons name="edit" size={22} color="#fff" />
                    <Text style={styles.swipeButtonText}>Redigera</Text>
                  </Pressable>
                </View>
              )}
              renderRightActions={() => (
                <View style={[styles.swipeActions, styles.swipeActionsRight]}>
                  <Pressable style={[styles.swipeButton, styles.deleteButton]} onPress={() => onDeleteFromSwipe(exercise)}>
                    <MaterialIcons name="delete" size={22} color="#fff" />
                    <Text style={styles.swipeButtonText}>Ta bort</Text>
                  </Pressable>
                </View>
              )}
            >
              <Pressable
                onPress={() => onCardPress(exercise.id)}
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

    </View>
  );
}

function TrainingScreen({
  workoutPlans,
  setWorkoutPlans,
  completedWorkouts,
  setCompletedWorkouts,
  exerciseWeightPbs,
  setExerciseWeightPbs,
  gymLibraryExercises,
  setGymLibraryExercises,
  onFabActionChange,
  onActiveSessionChange,
}: {
  workoutPlans: WorkoutPlan[];
  setWorkoutPlans: React.Dispatch<React.SetStateAction<WorkoutPlan[]>>;
  completedWorkouts: CompletedWorkout[];
  setCompletedWorkouts: React.Dispatch<React.SetStateAction<CompletedWorkout[]>>;
  exerciseWeightPbs: ExerciseWeightPb[];
  setExerciseWeightPbs: React.Dispatch<React.SetStateAction<ExerciseWeightPb[]>>;
  gymLibraryExercises: LibraryExercise[];
  setGymLibraryExercises: React.Dispatch<React.SetStateAction<LibraryExercise[]>>;
  onFabActionChange: (action: (() => void) | null) => void;
  onActiveSessionChange: (active: boolean) => void;
}) {
  type TrainingView = 'home' | 'session' | 'builder' | 'saved' | 'planDetail' | 'historyDetail' | 'pbOverview' | 'preloaded';
  type CardRect = { x: number; y: number; width: number; height: number };
  const insets = useSafeAreaInsets();
  const gymSheetMaxDrag = Math.round(Dimensions.get('window').height * 0.92);
  const [view, setView] = useState<TrainingView>('home');
  const [libraryMode, setLibraryMode] = useState<'session' | 'builder' | null>(null);
  const [sessionStartedAtIso, setSessionStartedAtIso] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [sessionExercises, setSessionExercises] = useState<SessionExercise[]>([]);
  const [sessionSourcePlanId, setSessionSourcePlanId] = useState<string | null>(null);
  const [sessionSourcePlanName, setSessionSourcePlanName] = useState<string | null>(null);
  const [builderName, setBuilderName] = useState('');
  const [builderExercises, setBuilderExercises] = useState<WorkoutPlanExercise[]>([]);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [builderConfirmVisible, setBuilderConfirmVisible] = useState(false);
  const [sessionConfirmVisible, setSessionConfirmVisible] = useState(false);
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
  const [gymLibraryEquipmentFilter, setGymLibraryEquipmentFilter] = useState<string | null>(null);
  const [gymSheetExpanded, setGymSheetExpanded] = useState(false);
  const [pbModalExercise, setPbModalExercise] = useState<SessionExercise | null>(null);
  const [pbSortMode, setPbSortMode] = useState<PbSortMode>('reps_desc');
  const [pbSummaryVisible, setPbSummaryVisible] = useState(false);
  const [pbSummaryRows, setPbSummaryRows] = useState<
    { exerciseName: string; weightKg: number; oldBestReps: number; newBestReps: number }[]
  >([]);
  const [pbSummaryTotal, setPbSummaryTotal] = useState(0);
  const gymSheetTranslateY = useRef(new Animated.Value(150)).current;
  const gymSheetStartY = useRef(150);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const transitionAnim = useRef(new Animated.Value(1)).current;
  const transitionBlurOpacity = useRef(new Animated.Value(0)).current;
  const transitionBusyRef = useRef(false);
  const transitionBeforeOpenRef = useRef<(() => void) | null>(null);
  const cardBounceAnim = useRef(new Animated.Value(1)).current;
  const cardPressAnim = useRef(new Animated.Value(1)).current;
  const trainingViewRef = useRef<View | null>(null);
  const startCardRef = useRef<View | null>(null);
  const builderCardRef = useRef<View | null>(null);
  const savedCardRef = useRef<View | null>(null);
  const preloadedCardRef = useRef<View | null>(null);
  const pbCardRef = useRef<View | null>(null);
  const [transitionContainerRect, setTransitionContainerRect] = useState<CardRect | null>(null);
  const [transitionOriginRect, setTransitionOriginRect] = useState<CardRect | null>(null);
  const [transitionActive, setTransitionActive] = useState(false);
  const [transitionMode, setTransitionMode] = useState<'idle' | 'opening' | 'closing'>('idle');
  const [transitionPreviewView, setTransitionPreviewView] = useState<Exclude<TrainingView, 'home'> | null>(null);
  const [lastClosedView, setLastClosedView] = useState<Exclude<TrainingView, 'home'> | null>(null);
  const [pressedCardView, setPressedCardView] = useState<Exclude<TrainingView, 'home'> | null>(null);
  const lastOriginByViewRef = useRef<Partial<Record<Exclude<TrainingView, 'home'>, CardRect>>>({});

  const SESSION_STORAGE_KEY = 'naphab_active_session_v1';

  // Restore active session on mount
  useEffect(() => {
    AsyncStorage.getItem(SESSION_STORAGE_KEY).then((raw) => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw) as { startedAtIso: string; exercises: SessionExercise[]; sourcePlanId: string | null; sourcePlanName: string | null };
        if (saved.startedAtIso && Array.isArray(saved.exercises)) {
          setSessionStartedAtIso(saved.startedAtIso);
          setSessionExercises(saved.exercises);
          setSessionSourcePlanId(saved.sourcePlanId);
          setSessionSourcePlanName(saved.sourcePlanName);
        }
      } catch { /* ignore */ }
    }).catch(() => {});
  }, []);

  // Persist active session whenever it changes
  useEffect(() => {
    if (!sessionStartedAtIso) {
      AsyncStorage.removeItem(SESSION_STORAGE_KEY).catch(() => {});
      return;
    }
    AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
      startedAtIso: sessionStartedAtIso,
      exercises: sessionExercises,
      sourcePlanId: sessionSourcePlanId,
      sourcePlanName: sessionSourcePlanName,
    })).catch(() => {});
  }, [sessionStartedAtIso, sessionExercises, sessionSourcePlanId, sessionSourcePlanName]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (sessionStartedAtIso) {
      showAndroidWorkoutNotification(sessionStartedAtIso).catch(() => {});
    } else {
      dismissAndroidWorkoutNotification().catch(() => {});
    }
  }, [sessionStartedAtIso]);

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

  // Notify parent when active session status changes (for navbar pulse)
  useEffect(() => {
    onActiveSessionChange(sessionStartedAtIso !== null);
  }, [sessionStartedAtIso, onActiveSessionChange]);

  // Track whether this tab is currently focused
  const screenFocusedRef = useRef(false);

  // Jump to session or reset to home when tab gains focus
  useFocusEffect(
    useCallback(() => {
      screenFocusedRef.current = true;
      if (sessionStartedAtIso) {
        setView('session');
      } else {
        setView('home');
      }
      return () => {
        screenFocusedRef.current = false;
      };
    }, [sessionStartedAtIso])
  );

  // Auto-jump to session when AsyncStorage restores a session while the tab is already active
  useEffect(() => {
    if (sessionStartedAtIso && screenFocusedRef.current) {
      setView('session');
    }
  }, [sessionStartedAtIso]);

  const formatDuration = (totalSec: number) => {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0
      ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  const pbSortLabel = useMemo(() => {
    if (pbSortMode === 'reps_desc') return 'Reps ↓';
    if (pbSortMode === 'reps_asc') return 'Reps ↑';
    if (pbSortMode === 'weight_desc') return 'Vikt ↓';
    if (pbSortMode === 'weight_asc') return 'Vikt ↑';
    return 'Senast datum ↓';
  }, [pbSortMode]);
  const gymLibraryIdByName = useMemo(
    () => new Map(gymLibraryExercises.map((exercise) => [exercise.name.trim().toLowerCase(), exercise.id])),
    [gymLibraryExercises],
  );
  const resolveSessionExercisePbId = useCallback((exercise: SessionExercise) => {
    if (exercise.libraryExerciseId) return exercise.libraryExerciseId;
    const fromLibrary = gymLibraryIdByName.get(exercise.name.trim().toLowerCase());
    if (fromLibrary) return fromLibrary;
    return `name:${exercise.name.trim().toLowerCase()}`;
  }, [gymLibraryIdByName]);
  const rebuildExerciseWeightPbsFromWorkouts = useCallback((workouts: CompletedWorkout[]): ExerciseWeightPb[] => {
    const byKey = new Map<string, ExerciseWeightPb>();
    workouts.forEach((workout) => {
      workout.exercises.forEach((exercise) => {
        const exerciseId = resolveSessionExercisePbId(exercise);
        exercise.sets.forEach((setEntry) => {
          if (setEntry.weightKg <= 0 || setEntry.reps <= 0) return;
          const weightKey = toWeightKey(setEntry.weightKg);
          const key = `${exerciseId}|${weightKey}`;
          const existing = byKey.get(key);
          if (!existing || setEntry.reps > existing.bestReps) {
            byKey.set(key, {
              exerciseId,
              weightKey,
              bestReps: setEntry.reps,
              date: workout.endedAtIso,
            });
            return;
          }
          if (setEntry.reps === existing.bestReps && new Date(workout.endedAtIso).getTime() > new Date(existing.date).getTime()) {
            byKey.set(key, { ...existing, date: workout.endedAtIso });
          }
        });
      });
    });
    const grouped = new Map<string, ExerciseWeightPb[]>();
    [...byKey.values()].forEach((entry) => {
      const list = grouped.get(entry.exerciseId) ?? [];
      grouped.set(entry.exerciseId, [...list, entry]);
    });
    const pruned: ExerciseWeightPb[] = [];
    grouped.forEach((rows) => {
      pruned.push(...pruneDominatedPbRows(rows));
    });
    return pruned;
  }, [resolveSessionExercisePbId]);
  useEffect(() => {
    // PB index is derived from history to avoid stale rows.
    setExerciseWeightPbs(rebuildExerciseWeightPbsFromWorkouts(completedWorkouts));
  }, [completedWorkouts, rebuildExerciseWeightPbsFromWorkouts, setExerciseWeightPbs]);
  const sessionSetFeedbackBySetKey = useMemo(() => {
    const feedbackBySet = new Map<
    string,
    {
      kind: 'new' | 'current';
      exerciseId: string;
      exerciseName: string;
      weightKey: number;
      weightKg: number;
      oldBestReps: number;
      newBestReps: number;
    }
    >();
    const baselineBest = new Map<string, number>();
    const baselineFrontierByExercise = new Map<string, { weightKey: number; bestReps: number }[]>();
    exerciseWeightPbs.forEach((entry) => {
      const key = `${entry.exerciseId}|${entry.weightKey}`;
      const previous = baselineBest.get(key) ?? 0;
      if (entry.bestReps > previous) baselineBest.set(key, entry.bestReps);
      const existing = baselineFrontierByExercise.get(entry.exerciseId) ?? [];
      baselineFrontierByExercise.set(
        entry.exerciseId,
        pruneDominatedPbRows([...existing, { weightKey: entry.weightKey, bestReps: entry.bestReps }]),
      );
    });
    sessionExercises.forEach((exercise) => {
      const exerciseId = resolveSessionExercisePbId(exercise);
      const finalBestByWeight = new Map<number, number>();
      exercise.sets.forEach((setEntry) => {
        if (setEntry.weightKg <= 0 || setEntry.reps <= 0) return;
        const weightKey = toWeightKey(setEntry.weightKg);
        const previous = finalBestByWeight.get(weightKey) ?? 0;
        if (setEntry.reps > previous) finalBestByWeight.set(weightKey, setEntry.reps);
      });
      const candidatePoints = [...finalBestByWeight.entries()]
        .map(([weightKey, bestReps]) => ({ weightKey, bestReps }))
        .filter((point) => point.bestReps > (baselineBest.get(`${exerciseId}|${point.weightKey}`) ?? 0));
      const frontierWithCandidates = pruneDominatedPbRows([
        ...(baselineFrontierByExercise.get(exerciseId) ?? []),
        ...candidatePoints,
      ]);
      const baselineFrontier = baselineFrontierByExercise.get(exerciseId) ?? [];
      const emittedPointKeys = new Set<string>();
      exercise.sets.forEach((setEntry) => {
        if (setEntry.weightKg <= 0 || setEntry.reps <= 0) return;
        const weightKey = toWeightKey(setEntry.weightKg);
        const bestForWeightInSession = finalBestByWeight.get(weightKey) ?? 0;
        if (setEntry.reps !== bestForWeightInSession) return;
        const oldBestReps = baselineBest.get(`${exerciseId}|${weightKey}`) ?? 0;
        const candidatePoint = { weightKey, bestReps: setEntry.reps };
        if (!frontierWithCandidates.some((point) => point.weightKey === candidatePoint.weightKey && point.bestReps === candidatePoint.bestReps)) return;
        const pointKey = `${candidatePoint.weightKey}|${candidatePoint.bestReps}`;
        if (emittedPointKeys.has(pointKey)) return;
        let kind: 'new' | 'current' | null = null;
        if (setEntry.reps > oldBestReps) {
          kind = 'new';
        } else if (
          oldBestReps > 0
          && setEntry.reps === oldBestReps
          && baselineFrontier.some((point) => point.weightKey === candidatePoint.weightKey && point.bestReps === candidatePoint.bestReps)
        ) {
          kind = 'current';
        }
        if (!kind) return;
        emittedPointKeys.add(pointKey);
        feedbackBySet.set(`${exercise.id}|${setEntry.id}`, {
          kind,
          exerciseId,
          exerciseName: exercise.name,
          weightKey,
          weightKg: weightKeyToKg(weightKey),
          oldBestReps,
          newBestReps: setEntry.reps,
        });
      });
    });
    return feedbackBySet;
  }, [exerciseWeightPbs, resolveSessionExercisePbId, sessionExercises]);
  const sessionPbEvents = useMemo(() => {
    const map = new Map<string, { exerciseId: string; exerciseName: string; weightKey: number; weightKg: number; oldBestReps: number; newBestReps: number }>();
    sessionSetFeedbackBySetKey.forEach((entry) => {
      if (entry.kind !== 'new') return;
      const key = `${entry.exerciseId}|${entry.weightKey}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { ...entry });
        return;
      }
      map.set(key, { ...existing, newBestReps: Math.max(existing.newBestReps, entry.newBestReps) });
    });
    return [...map.values()];
  }, [sessionSetFeedbackBySetKey]);
  const pbOverviewExercises = useMemo(() => {
    const grouped = new Map<string, ExerciseWeightPb[]>();
    exerciseWeightPbs.forEach((entry) => {
      const list = grouped.get(entry.exerciseId) ?? [];
      grouped.set(entry.exerciseId, [...list, entry]);
    });
    return [...grouped.entries()]
      .map(([exerciseId, rows]) => {
        const fromLibrary = gymLibraryExercises.find((exercise) => exercise.id === exerciseId);
        const fallbackName = exerciseId.startsWith('name:') ? exerciseId.slice('name:'.length) : exerciseId;
        const displayName = fromLibrary?.name || fallbackName;
        const bestReps = rows.reduce((max, row) => Math.max(max, row.bestReps), 0);
        const highestWeightKey = rows.reduce((max, row) => Math.max(max, row.weightKey), 0);
        return { exerciseId, displayName, rowsCount: rows.length, bestReps, highestWeightKey };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'sv-SE'));
  }, [exerciseWeightPbs, gymLibraryExercises]);
  const selectedPbExerciseId = useMemo(
    () => (pbModalExercise ? resolveSessionExercisePbId(pbModalExercise) : null),
    [pbModalExercise, resolveSessionExercisePbId],
  );
  const selectedExercisePbRows = useMemo(() => {
    if (!selectedPbExerciseId) return [];
    const rows = pruneDominatedPbRows(exerciseWeightPbs.filter((entry) => entry.exerciseId === selectedPbExerciseId));
    return rows.sort((a, b) => {
      if (pbSortMode === 'reps_desc') {
        if (b.bestReps !== a.bestReps) return b.bestReps - a.bestReps;
        return b.weightKey - a.weightKey;
      }
      if (pbSortMode === 'reps_asc') {
        if (a.bestReps !== b.bestReps) return a.bestReps - b.bestReps;
        return a.weightKey - b.weightKey;
      }
      if (pbSortMode === 'weight_desc') return b.weightKey - a.weightKey;
      if (pbSortMode === 'weight_asc') return a.weightKey - b.weightKey;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [exerciseWeightPbs, pbSortMode, selectedPbExerciseId]);
  const cyclePbSortMode = () => {
    const idx = PB_SORT_ORDER.indexOf(pbSortMode);
    const nextIdx = (idx + 1) % PB_SORT_ORDER.length;
    setPbSortMode(PB_SORT_ORDER[nextIdx]);
  };
  const openPbModal = (exercise: SessionExercise) => {
    setPbModalExercise(exercise);
  };
  const openPbModalByExerciseId = (exerciseId: string, displayName: string) => {
    setPbModalExercise({
      id: `pb-overview-${exerciseId}`,
      libraryExerciseId: exerciseId.startsWith('name:') ? undefined : exerciseId,
      name: displayName,
      sets: [],
    });
  };
  const closePbModal = () => {
    setPbModalExercise(null);
  };
  const confirmAbortWorkout = () => {
    Alert.alert(
      'Avbryta pass?',
      'Vill du avbryta passet? Passet sparas inte.',
      [
        { text: 'Nej', style: 'cancel' },
        { text: 'Avbryt pass', style: 'destructive', onPress: endSessionWithoutSaving },
      ],
    );
  };

  const openLibrary = (mode: 'session' | 'builder') => {
    setLibraryMode(mode);
    setGymSheetExpanded(true);
    gymSheetTranslateY.setValue(80);
    setGymLibraryQuery('');
    setGymLibraryFilter(null);
    setGymLibraryEquipmentFilter(null);
    setGymLibraryVisible(true);
  };
  useEffect(() => {
    if (gymLibraryVisible) {
      Animated.spring(gymSheetTranslateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 22,
        stiffness: 220,
      }).start();
    }
  }, [gymLibraryVisible, gymSheetTranslateY]);

  const addLibraryExercise = (exercise: LibraryExercise) => {
    if (!libraryMode) return;
    if (libraryMode === 'session') {
      setSessionExercises((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, libraryExerciseId: exercise.id, name: exercise.name, sets: [] }]);
    } else {
      setBuilderExercises((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, libraryExerciseId: exercise.id, name: exercise.name, sets: 1, reps: 10, repsPerSet: [10] }]);
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
      const matchesBody = !gymLibraryFilter || exercise.tags.includes(gymLibraryFilter);
      const matchesEquipment = !gymLibraryEquipmentFilter || exercise.tags.includes(gymLibraryEquipmentFilter);
      return matchesQuery && matchesBody && matchesEquipment;
    });
  }, [gymLibraryExercises, gymLibraryFilter, gymLibraryEquipmentFilter, gymLibraryQuery]);
  const gymBodyPartFilters = useMemo(
    () =>
      [...new Set(gymLibraryExercises.flatMap((e) => e.tags))].filter(
        (tag) => !GYM_EQUIPMENT_SET.has(tag),
      ),
    [gymLibraryExercises],
  );
  const gymCategoryChoices = useMemo(() => {
    const combined = [...gymBodyPartFilters, ...GYM_EQUIPMENT_TAGS, ...gymCategoryDraftTags];
    return [...new Set(combined)].sort((a, b) => a.localeCompare(b, 'sv-SE'));
  }, [gymBodyPartFilters, gymCategoryDraftTags]);
  const gymOtherDraftTags = useMemo(
    () =>
      gymCategoryDraftTags.filter(
        (tag) => !gymBodyPartFilters.includes(tag) && !GYM_EQUIPMENT_TAGS.includes(tag),
      ),
    [gymCategoryDraftTags, gymBodyPartFilters],
  );
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
      setGymLibraryEquipmentFilter(null);
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

  const sessionRemoveLastSet = (exerciseId: string) =>
    setSessionExercises((prev) =>
      prev.map((exercise) => {
        if (exercise.id !== exerciseId) return exercise;
        return { ...exercise, sets: exercise.sets.slice(0, -1) };
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
    setPbModalExercise(null);
    setPbSummaryVisible(false);
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
    setPbModalExercise(null);
    setPbSummaryVisible(false);
    setSessionStartedAtIso(null);
    setElapsedSeconds(0);
    goHomeWithReverseTransition();
  };

  const getRepsPerSet = (ex: WorkoutPlanExercise): number[] => {
    if (ex.repsPerSet && ex.repsPerSet.length > 0) return ex.repsPerSet;
    return Array(ex.sets || 1).fill(ex.reps ?? 10);
  };

  const buildSessionExercisesFromPlan = (plan: WorkoutPlan): SessionExercise[] =>
    plan.exercises.map((exercise) => {
      const rp = getRepsPerSet(exercise);
      return {
        id: `${Date.now()}-${Math.random()}`,
        libraryExerciseId: exercise.libraryExerciseId,
        name: exercise.name,
        sets: rp.map((reps) => ({
          id: `${Date.now()}-${Math.random()}`,
          reps,
          weightKg: 0,
        })),
      };
    });

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
    setBuilderExercises(
      plan.exercises.map((exercise) => {
        const rp = getRepsPerSet(exercise);
        return { ...exercise, repsPerSet: rp, sets: rp.length, reps: rp[0] ?? 10 };
      }),
    );
    setView('builder');
  };

  const openPlanDetail = (plan: WorkoutPlan) => {
    setSelectedPlanId(plan.id);
    setView('planDetail');
  };

  const goBackToSaved = () => {
    setSelectedPlanId(null);
    setView('saved');
  };

  const commitCompletedWorkout = () => {
    if (!sessionStartedAtIso) return;
    if (!hasLoggedSessionContent) {
      Alert.alert('Inget att spara', 'Lägg till minst en övning med minst ett set innan du sparar passet.');
      return;
    }
    const endedAtIso = new Date().toISOString();
    const durationSec = Math.max(0, Math.floor((new Date(endedAtIso).getTime() - new Date(sessionStartedAtIso).getTime()) / 1000));
    if (sessionPbEvents.length > 0) {
      setExerciseWeightPbs((prev) => {
        const byKey = new Map(prev.map((entry) => [`${entry.exerciseId}|${entry.weightKey}`, entry]));
        sessionPbEvents.forEach((event) => {
          const key = `${event.exerciseId}|${event.weightKey}`;
          const existing = byKey.get(key);
          if (!existing || event.newBestReps > existing.bestReps) {
            byKey.set(key, {
              exerciseId: event.exerciseId,
              weightKey: event.weightKey,
              bestReps: event.newBestReps,
              date: endedAtIso,
            });
          }
        });
        const grouped = new Map<string, ExerciseWeightPb[]>();
        [...byKey.values()].forEach((entry) => {
          const list = grouped.get(entry.exerciseId) ?? [];
          grouped.set(entry.exerciseId, [...list, entry]);
        });
        const pruned: ExerciseWeightPb[] = [];
        grouped.forEach((rows) => {
          pruned.push(...pruneDominatedPbRows(rows));
        });
        return pruned;
      });
    }
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
    if (sessionPbEvents.length > 0) {
      const maxRows = 8;
      const rows = [...sessionPbEvents]
        .sort((a, b) => a.exerciseName.localeCompare(b.exerciseName, 'sv-SE'))
        .slice(0, maxRows);
      setPbSummaryRows(rows);
      setPbSummaryTotal(sessionPbEvents.length);
      setPbSummaryVisible(true);
    }
  };
  const saveCompletedWorkout = () => {
    if (!hasLoggedSessionContent) {
      endSessionWithoutSaving();
      return;
    }
    setSessionConfirmVisible(true);
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
    setCompletedWorkouts((prev) => {
      const next = prev.filter((item) => !selectedHistoryWorkoutIds.includes(item.id));
      setExerciseWeightPbs(rebuildExerciseWeightPbsFromWorkouts(next));
      return next;
    });
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
  const getFallbackContainerRect = useCallback((): CardRect => {
    const windowRect = Dimensions.get('window');
    return {
      x: 0,
      y: insets.top,
      width: windowRect.width,
      height: windowRect.height - insets.top,
    };
  }, [insets.top]);

  const measureRefRect = useCallback((ref: React.RefObject<View | null>) => new Promise<CardRect | null>((resolve) => {
    const node = ref.current as (View & { measureInWindow?: (cb: (x: number, y: number, width: number, height: number) => void) => void }) | null;
    if (!node || typeof node.measureInWindow !== 'function') {
      resolve(null);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        resolve(null);
        return;
      }
      resolve({ x, y, width, height });
    });
  }), []);
  const runCardOpenTransition = useCallback(async (
    nextView: Exclude<TrainingView, 'home'>,
    cardRef: React.RefObject<View | null>,
    beforeOpen?: () => void,
  ) => {
    if (transitionBusyRef.current) return;
    transitionBusyRef.current = true;
    setPressedCardView(nextView);
    cardPressAnim.setValue(1);
    Animated.timing(cardPressAnim, {
      toValue: 0.95,
      duration: 80,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    setTransitionMode('opening');
    setTransitionPreviewView(nextView);
    setLastClosedView(null);
    transitionBeforeOpenRef.current = beforeOpen ?? null;
    const [origin, container] = await Promise.all([
      measureRefRect(cardRef),
      measureRefRect(trainingViewRef),
    ]);
    if (!origin || !container) {
      transitionBeforeOpenRef.current?.();
      transitionBeforeOpenRef.current = null;
      setView(nextView);
      setTransitionMode('idle');
      setTransitionPreviewView(null);
      cardPressAnim.setValue(1);
      setPressedCardView(null);
      transitionBusyRef.current = false;
      return;
    }
    setTransitionContainerRect(container);
    setTransitionOriginRect(origin);
    setTransitionActive(true);
    transitionAnim.setValue(0);
    transitionBlurOpacity.setValue(0);
    Animated.timing(transitionAnim, {
      toValue: 1,
      duration: 360,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      transitionBeforeOpenRef.current?.();
      transitionBeforeOpenRef.current = null;
      setView(nextView);
      lastOriginByViewRef.current[nextView] = origin;
      cardPressAnim.setValue(1);
      setPressedCardView(null);
      requestAnimationFrame(() => {
        setTransitionActive(false);
        setTransitionOriginRect(null);
        setTransitionMode('idle');
        setTransitionPreviewView(null);
        transitionBusyRef.current = false;
      });
    });
  }, [measureRefRect, transitionAnim]);

  const cardRefByView: Record<string, React.RefObject<View | null>> = {
    session: startCardRef,
    builder: builderCardRef,
    saved: savedCardRef,
    preloaded: preloadedCardRef,
    pbOverview: pbCardRef,
  };

  const runCardBounce = useCallback(() => {
    cardBounceAnim.setValue(0.92);
    Animated.spring(cardBounceAnim, {
      toValue: 1,
      friction: 4,
      tension: 200,
      useNativeDriver: true,
    }).start();
  }, [cardBounceAnim]);

  const goHomeWithReverseTransition = useCallback(async () => {
    if (view === 'home' || transitionBusyRef.current) {
      return;
    }
    transitionBusyRef.current = true;
    const closingView = view as Exclude<TrainingView, 'home'>;
    const shouldClearSession = closingView === 'session' && sessionExercises.length === 0;
    setTransitionMode('closing');
    setTransitionPreviewView(closingView);
    const lastOrigin = lastOriginByViewRef.current[closingView] ?? null;
    const container = await measureRefRect(trainingViewRef);
    if (!lastOrigin || !container) {
      if (shouldClearSession) {
        setSessionExercises([]);
        setSessionSourcePlanId(null);
        setSessionSourcePlanName(null);
        setPbModalExercise(null);
        setPbSummaryVisible(false);
        setSessionStartedAtIso(null);
        setElapsedSeconds(0);
      }
      setView('home');
      setTransitionMode('idle');
      setTransitionPreviewView(null);
      transitionBusyRef.current = false;
      return;
    }
    setTransitionContainerRect(container);
    setTransitionOriginRect(lastOrigin);
    setTransitionActive(true);
    transitionAnim.setValue(1);
    setView('home');
    Animated.timing(transitionAnim, {
      toValue: 0,
      duration: 320,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (shouldClearSession) {
        setSessionExercises([]);
        setSessionSourcePlanId(null);
        setSessionSourcePlanName(null);
        setPbModalExercise(null);
        setPbSummaryVisible(false);
        setSessionStartedAtIso(null);
        setElapsedSeconds(0);
      }
      setTransitionActive(false);
      setTransitionOriginRect(null);
      transitionAnim.setValue(1);
      setTransitionMode('idle');
      setTransitionPreviewView(null);
      transitionBusyRef.current = false;
      setLastClosedView(closingView);
      runCardBounce();
    });
  }, [measureRefRect, transitionAnim, runCardBounce, sessionExercises.length, view]);

  useEffect(() => {
    const onBackPress = () => {
      if (view === 'home') return false;
      if (gymLibraryVisible) {
        closeGymLibrary();
      } else if (view === 'planDetail') {
        goBackToSaved();
      } else {
        goHomeWithReverseTransition();
      }
      return true;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [closeGymLibrary, goHomeWithReverseTransition, goBackToSaved, gymLibraryVisible, view]);
  const gymSheetCloseThreshold = Math.round(gymSheetMaxDrag * 0.25);
  const gymSheetPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onMoveShouldSetPanResponderCapture: (_, gesture) => Math.abs(gesture.dy) > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
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

  const builderUpdateSetReps = (exerciseId: string, setIndex: number, delta: number) => {
    setBuilderExercises((prev) =>
      prev.map((e) => {
        if (e.id !== exerciseId) return e;
        const rp = getRepsPerSet(e);
        if (setIndex < 0 || setIndex >= rp.length) return e;
        const next = [...rp];
        next[setIndex] = Math.max(1, Math.min(99, next[setIndex] + delta));
        return { ...e, repsPerSet: next, sets: next.length, reps: next[0] ?? 10 };
      }),
    );
  };

  const builderAddSet = (exerciseId: string) => {
    setBuilderExercises((prev) =>
      prev.map((e) => {
        if (e.id !== exerciseId) return e;
        const rp = getRepsPerSet(e);
        const last = rp[rp.length - 1] ?? 10;
        const next = [...rp, last];
        return { ...e, repsPerSet: next, sets: next.length, reps: next[0] ?? 10 };
      }),
    );
  };

  const builderRemoveSet = (exerciseId: string) => {
    setBuilderExercises((prev) =>
      prev.map((e) => {
        if (e.id !== exerciseId) return e;
        const rp = getRepsPerSet(e);
        if (rp.length <= 1) return e;
        const next = rp.slice(0, -1);
        return { ...e, repsPerSet: next, sets: next.length, reps: next[0] ?? 10 };
      }),
    );
  };

  const saveBuilderPlan = () => {
    if (builderExercises.length === 0) {
      Alert.alert('Inget att spara', 'Lägg till minst en övning innan du sparar passet.');
      return;
    }
    setBuilderConfirmVisible(false);
    const name = builderName.trim() || `Pass ${new Intl.DateTimeFormat('sv-SE', { day: '2-digit', month: '2-digit' }).format(new Date())}`;
    const exercisesToSave = builderExercises.map((exercise) => {
      const rp = getRepsPerSet(exercise);
      return { ...exercise, repsPerSet: rp, sets: rp.length, reps: rp[0] ?? 10 };
    });
    setWorkoutPlans((prev) => {
      if (editingPlanId) {
        return prev.map((plan) =>
          plan.id === editingPlanId ? { ...plan, name, exercises: exercisesToSave } : plan,
        );
      }
      return [
        { id: `${Date.now()}`, name, exercises: exercisesToSave, createdAtIso: new Date().toISOString() },
        ...prev,
      ];
    });
    setBuilderName('');
    setBuilderExercises([]);
    setEditingPlanId(null);
    goHomeWithReverseTransition();
  };

  const openBuilderConfirm = () => {
    if (builderExercises.length === 0) {
      Alert.alert('Inget att spara', 'Lägg till minst en övning innan du sparar passet.');
      return;
    }
    setBuilderConfirmVisible(true);
  };

  const confirmDeletePlan = (planId: string, planName: string, onDeleted?: () => void) => {
    Alert.alert(
      'Ta bort pass?',
      `Vill du ta bort "${planName}"? Det går inte att ångra.`,
      [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Ta bort',
          style: 'destructive',
          onPress: () => {
            setWorkoutPlans((prev) => prev.filter((p) => p.id !== planId));
            onDeleted?.();
          },
        },
      ],
    );
  };

  useEffect(() => {
    if (view === 'session') {
      onFabActionChange(() => openLibrary('session'));
      return;
    }
    if (view === 'builder') {
      onFabActionChange(() => openLibrary('builder'));
      return;
    }
    if (view === 'historyDetail') {
      onFabActionChange(() => {
        setView('builder');
        openLibrary('builder');
      });
      return;
    }
    if (view === 'planDetail') {
      onFabActionChange(null);
      return;
    }
    onFabActionChange(() => setView('builder'));
    return () => onFabActionChange(null);
  }, [onFabActionChange, view, openLibrary]);

  const windowRect = Dimensions.get('window');
  const containerRect = transitionContainerRect ?? {
    x: 0,
    y: insets.top,
    width: windowRect.width,
    height: windowRect.height - insets.top,
  };
  const hasOriginTransition = transitionActive && !!transitionOriginRect;
  const startScaleX = hasOriginTransition && transitionOriginRect
    ? Math.max(MIN_CARD_TRANSITION_SCALE, transitionOriginRect.width / containerRect.width)
    : 0.98;
  const startScaleY = hasOriginTransition && transitionOriginRect
    ? Math.max(MIN_CARD_TRANSITION_SCALE, transitionOriginRect.height / containerRect.height)
    : 0.98;
  const offsetX = hasOriginTransition && transitionOriginRect
    ? (transitionOriginRect.x + transitionOriginRect.width / 2) - (containerRect.x + containerRect.width / 2)
    : 0;
  const offsetY = hasOriginTransition && transitionOriginRect
    ? (transitionOriginRect.y + transitionOriginRect.height / 2) - (containerRect.y + containerRect.height / 2)
    : 0;
  const transitionOpacity = transitionAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.82, 1],
  });
  const transitionScaleX = transitionAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [startScaleX, 1],
  });
  const transitionScaleY = transitionAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [startScaleY, 1],
  });
  const transitionCornerRadius = transitionAnim.interpolate({
    inputRange: [0, 0.85, 1],
    outputRange: [CARD_TRANSITION_CORNER_RADIUS, 2, 0],
    extrapolate: 'clamp',
  });
  const transitionPreviewFadeOpacity = transitionMode === 'opening'
    ? transitionAnim.interpolate({
        inputRange: [0, 0.4, 1],
        outputRange: [0, 1, 1],
        extrapolate: 'clamp',
      })
    : transitionAnim.interpolate({
        inputRange: [0, 0.15, 1],
        outputRange: [0, 1, 1],
        extrapolate: 'clamp',
      });
  const transitionContentFadeOpacity = transitionAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const transitionTranslateX = transitionAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [offsetX, 0],
  });
  const transitionTranslateY = transitionAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [offsetY, 0],
  });
  const shouldHoldSourceView = transitionMode === 'opening';
  const shouldFreezeMainView = transitionMode === 'opening' || transitionMode === 'closing';
  const showTransitionPreview = transitionActive
    && (transitionMode === 'opening' || transitionMode === 'closing')
    && !!transitionPreviewView;
  const currentTransitionOpacity = shouldFreezeMainView ? 1 : transitionOpacity;
  const currentTransitionTranslateX = shouldFreezeMainView ? 0 : transitionTranslateX;
  const currentTransitionTranslateY = shouldFreezeMainView ? 0 : transitionTranslateY;
  const currentTransitionScaleX = shouldFreezeMainView ? 1 : transitionScaleX;
  const currentTransitionScaleY = shouldFreezeMainView ? 1 : transitionScaleY;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Text style={styles.screenTitleSmall}>Träning</Text>
      <View style={styles.trainingTransitionHost}>
        <Animated.View
          ref={trainingViewRef}
          style={[
            styles.trainingViewWrap,
            {
              opacity: currentTransitionOpacity,
              transform: [
                { translateX: currentTransitionTranslateX },
                { translateY: currentTransitionTranslateY },
                { scaleX: currentTransitionScaleX },
                { scaleY: currentTransitionScaleY },
              ],
            },
          ]}
        >
      {view === 'home' ? (
        <ScrollView contentContainerStyle={styles.listContent}>
          {/* Primär kort: Starta träning / Fortsätt pågående */}
          {sessionStartedAtIso ? (
            <Animated.View style={{ transform: [{ scale: pulseAnim }, { scale: lastClosedView === 'session' ? cardBounceAnim : 1 }, { scale: pressedCardView === 'session' ? cardPressAnim : 1 }] }}>
              <Pressable
                ref={startCardRef}
                style={styles.trainingHomeCard}
                onPress={() => runCardOpenTransition('session', startCardRef)}
              >
                <View style={[styles.trainingHomeCardIconWrap, { backgroundColor: '#4CAF50' }]}>
                  <MaterialCommunityIcons name="run" size={24} color="#FFFFFF" />
                </View>
                <View style={styles.trainingHomeCardTextWrap}>
                  <Text style={styles.trainingHomeCardTitle}>Fortsätt pågående pass</Text>
                  <Text style={styles.trainingHomeCardSubtitle}>Tid: {formatDuration(elapsedSeconds)}</Text>
                </View>
                <MaterialIcons name="chevron-right" size={24} color="#8FA1B3" />
              </Pressable>
            </Animated.View>
          ) : (
            <Animated.View style={{ transform: [{ scale: lastClosedView === 'session' ? cardBounceAnim : 1 }, { scale: pressedCardView === 'session' ? cardPressAnim : 1 }] }}>
            <Pressable
              ref={startCardRef}
              style={styles.trainingHomeCard}
              onPress={() => runCardOpenTransition('session', startCardRef, () => {
                setSessionExercises([]);
                setSessionSourcePlanId(null);
                setSessionSourcePlanName(null);
                setPbModalExercise(null);
                setPbSummaryVisible(false);
                setSessionStartedAtIso(new Date().toISOString());
                setElapsedSeconds(0);
              })}
            >
              <View style={[styles.trainingHomeCardIconWrap, { backgroundColor: '#4CAF50' }]}>
                <MaterialCommunityIcons name="dumbbell" size={24} color="#FFFFFF" />
              </View>
              <View style={styles.trainingHomeCardTextWrap}>
                <Text style={styles.trainingHomeCardTitle}>Starta träning</Text>
                <Text style={styles.trainingHomeCardSubtitle}>Starta nytt pass från scratch</Text>
              </View>
              <MaterialIcons name="chevron-right" size={24} color="#8FA1B3" />
            </Pressable>
            </Animated.View>
          )}
          {/* Rad: Skapa pass | Mina pass */}
          <View style={styles.trainingHomeCardRow}>
            <Animated.View style={[styles.trainingHomeCardHalf, { transform: [{ scale: lastClosedView === 'builder' ? cardBounceAnim : 1 }, { scale: pressedCardView === 'builder' ? cardPressAnim : 1 }] }]}>
            <Pressable
              ref={builderCardRef}
              style={styles.trainingHomeCardStacked}
              onPress={() => runCardOpenTransition('builder', builderCardRef, () => {
                setBuilderName('');
                setBuilderExercises([]);
                setEditingPlanId(null);
              })}
            >
              <View style={styles.trainingHomeCardStackedTop}>
                <View style={[styles.trainingHomeCardIconWrap, { backgroundColor: '#2196F3' }]}>
                  <MaterialIcons name="add-circle-outline" size={24} color="#FFFFFF" />
                </View>
                <MaterialIcons name="chevron-right" size={24} color="#8FA1B3" />
              </View>
              <Text style={styles.trainingHomeCardTitle} numberOfLines={1} ellipsizeMode="tail">Skapa pass</Text>
            </Pressable>
            </Animated.View>
            <Animated.View style={[styles.trainingHomeCardHalf, { transform: [{ scale: lastClosedView === 'saved' ? cardBounceAnim : 1 }, { scale: pressedCardView === 'saved' ? cardPressAnim : 1 }] }]}>
            <Pressable
              ref={savedCardRef}
              style={styles.trainingHomeCardStacked}
              onPress={() => runCardOpenTransition('saved', savedCardRef)}
            >
              <View style={styles.trainingHomeCardStackedTop}>
                <View style={[styles.trainingHomeCardIconWrap, { backgroundColor: '#9C27B0' }]}>
                  <MaterialIcons name="list-alt" size={24} color="#FFFFFF" />
                </View>
                <MaterialIcons name="chevron-right" size={24} color="#8FA1B3" />
              </View>
              <Text style={styles.trainingHomeCardTitle} numberOfLines={1} ellipsizeMode="tail">Mina pass</Text>
            </Pressable>
            </Animated.View>
          </View>
          {/* Rad: Förinlagda pass | Mina PB's */}
          <View style={styles.trainingHomeCardRow}>
            <Animated.View style={[styles.trainingHomeCardHalf, { transform: [{ scale: lastClosedView === 'preloaded' ? cardBounceAnim : 1 }, { scale: pressedCardView === 'preloaded' ? cardPressAnim : 1 }] }]}>
            <Pressable
              ref={preloadedCardRef}
              style={styles.trainingHomeCardStacked}
              onPress={() => runCardOpenTransition('preloaded', preloadedCardRef)}
            >
              <View style={styles.trainingHomeCardStackedTop}>
                <View style={[styles.trainingHomeCardIconWrap, { backgroundColor: '#009688' }]}>
                  <MaterialCommunityIcons name="calendar-check" size={24} color="#FFFFFF" />
                </View>
                <MaterialIcons name="chevron-right" size={24} color="#8FA1B3" />
              </View>
              <Text style={styles.trainingHomeCardTitle} numberOfLines={1} ellipsizeMode="tail">Förinlagda pass</Text>
            </Pressable>
            </Animated.View>
            <Animated.View style={[styles.trainingHomeCardHalf, { transform: [{ scale: lastClosedView === 'pbOverview' ? cardBounceAnim : 1 }, { scale: pressedCardView === 'pbOverview' ? cardPressAnim : 1 }] }]}>
            <Pressable
              ref={pbCardRef}
              style={styles.trainingHomeCardStacked}
              onPress={() => runCardOpenTransition('pbOverview', pbCardRef)}
            >
              <View style={styles.trainingHomeCardStackedTop}>
                <View style={[styles.trainingHomeCardIconWrap, { backgroundColor: '#FF9800' }]}>
                  <MaterialCommunityIcons name="trophy" size={24} color="#FFFFFF" />
                </View>
                <MaterialIcons name="chevron-right" size={24} color="#8FA1B3" />
              </View>
              <Text style={styles.trainingHomeCardTitle} numberOfLines={1} ellipsizeMode="tail">Mina PB&apos;s</Text>
            </Pressable>
            </Animated.View>
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
            <View style={styles.trainingSessionTopRow}>
              <Pressable style={styles.trainingMiniButton} onPress={goHomeWithReverseTransition}>
                <MaterialIcons name="arrow-back" size={20} color="#DCE4EC" />
              </Pressable>
              <Text style={styles.trainingTimer}>{formatDuration(elapsedSeconds)}</Text>
              <View style={styles.trainingTopActionsRight}>
                <Pressable style={styles.trainingMiniPrimaryButton} onPress={saveCompletedWorkout}>
                  <MaterialIcons name="check" size={20} color="#0F1419" />
                </Pressable>
                <Pressable style={styles.trainingMiniDangerButton} onPress={confirmAbortWorkout}>
                  <MaterialIcons name="delete-outline" size={20} color="#EF9A9A" />
                </Pressable>
              </View>
            </View>
          </View>
          <ScrollView contentContainerStyle={styles.listContent}>
            {sessionExercises.length === 0 ? <Text style={styles.loggedSetEmpty}>Inga övningar än. Tryck på ＋.</Text> : null}
            {sessionExercises.map((exercise) => (
              <View key={exercise.id} style={styles.trainingCard}>
                <View style={styles.trainingHeader}>
                  <Pressable onPress={() => openPbModal(exercise)}>
                    <Text style={styles.trainingTitle}>{exercise.name}</Text>
                  </Pressable>
                  <Pressable onPress={() => setSessionExercises((prev) => prev.filter((item) => item.id !== exercise.id))}>
                    <MaterialIcons name="delete" size={22} color="#EF9A9A" />
                  </Pressable>
                </View>
                <View style={styles.loggedSetList}>
                  {exercise.sets.length === 0 ? <Text style={styles.loggedSetEmpty}>Inga set ännu. Tryck på + Set.</Text> : null}
                  {exercise.sets.map((setEntry, index) => (
                    <View key={setEntry.id} style={styles.loggedSetRow}>
                      <View style={styles.loggedSetRowMain}>
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
                      {(() => {
                        const feedback = sessionSetFeedbackBySetKey.get(`${exercise.id}|${setEntry.id}`);
                        if (!feedback) return null;
                        return (
                          <View style={styles.pbFeedbackBox}>
                            <Text style={styles.pbFeedbackTitle}>{feedback.kind === 'new' ? '🏆 NYTT PB!' : 'Nuvarande PB'}</Text>
                          </View>
                        );
                      })()}
                    </View>
                  ))}
                </View>
                <View style={styles.trainingButtons}>
                  <Button
                    mode="outlined"
                    disabled={exercise.sets.length === 0}
                    onPress={() => sessionRemoveLastSet(exercise.id)}
                  >− Set</Button>
                  <Button mode="contained" onPress={() => sessionAddSet(exercise.id)}>+ Set</Button>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {view === 'historyDetail' && selectedHistoryWorkout ? (
        <View style={styles.screen}>
          <View style={styles.trainingSessionTop}>
            <View style={styles.trainingSessionTopRow}>
              <Pressable style={styles.trainingMiniButton} onPress={goHomeWithReverseTransition}>
                <MaterialIcons name="arrow-back" size={20} color="#DCE4EC" />
              </Pressable>
              <Text style={styles.trainingTimer}>{resolveWorkoutDisplay(selectedHistoryWorkout).name}</Text>
              <View style={styles.trainingTopActionsRight} />
            </View>
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
        </View>
      ) : null}

      {view === 'builder' ? (
        <View style={styles.screen}>
          <View style={styles.trainingSessionTop}>
            <View style={styles.trainingSessionTopRow}>
              <Pressable style={styles.trainingMiniButton} onPress={() => { setEditingPlanId(null); goHomeWithReverseTransition(); }}>
                <MaterialIcons name="arrow-back" size={20} color="#DCE4EC" />
              </Pressable>
              <Text style={styles.trainingTimer}>{editingPlanId ? 'Redigera pass' : 'Skapa pass'}</Text>
              <View style={styles.trainingTopActionsRight}>
                <Pressable style={styles.trainingMiniPrimaryButton} onPress={openBuilderConfirm}>
                  <MaterialIcons name="check" size={20} color="#0F1419" />
                </Pressable>
              </View>
            </View>
          </View>
          <ScrollView contentContainerStyle={styles.listContent}>
            <TextInput value={builderName} onChangeText={setBuilderName} style={styles.input} placeholder="Namn på pass" placeholderTextColor={PLACEHOLDER_COLOR} />
            {builderExercises.length === 0 ? <Text style={styles.loggedSetEmpty}>Lägg till övningar med ＋.</Text> : null}
            {builderExercises.map((exercise) => {
              const repsArr = getRepsPerSet(exercise);
              return (
                <View key={exercise.id} style={styles.trainingCard}>
                  <View style={styles.trainingHeader}>
                    <Text style={styles.trainingTitle}>{exercise.name}</Text>
                    <Pressable onPress={() => setBuilderExercises((prev) => prev.filter((item) => item.id !== exercise.id))}>
                      <MaterialIcons name="delete" size={22} color="#EF9A9A" />
                    </Pressable>
                  </View>
                  <View style={{ paddingLeft: 12, paddingRight: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: '#253545' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 2 }}>
                      <View style={{ minWidth: 36 }} />
                      <Text style={[styles.loggedSetMetricLabel, { marginLeft: 32 }]}>Reps</Text>
                    </View>
                    {repsArr.map((repsVal, setIdx) => (
                      <View key={setIdx} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                        <Text style={[styles.loggedSetMetricLabel, { minWidth: 36 }]}>Set {setIdx + 1}</Text>
                        <View style={styles.trainingStatActions}>
                          <Pressable style={styles.trainingStatButton} onPress={() => builderUpdateSetReps(exercise.id, setIdx, -1)}>
                            <Text style={styles.trainingStatButtonText}>-</Text>
                          </Pressable>
                          <Text style={styles.loggedSetMetricValue}>{repsVal}</Text>
                          <Pressable style={styles.trainingStatButton} onPress={() => builderUpdateSetReps(exercise.id, setIdx, 1)}>
                            <Text style={styles.trainingStatButtonText}>+</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                    <View style={styles.trainingButtons}>
                      <Button
                        mode="outlined"
                        disabled={repsArr.length <= 1}
                        onPress={() => builderRemoveSet(exercise.id)}
                      >− Set</Button>
                      <Button mode="contained" onPress={() => builderAddSet(exercise.id)}>+ Set</Button>
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {view === 'saved' ? (
        <View style={styles.screen}>
          <View style={styles.trainingSessionTop}>
            <View style={styles.trainingSessionTopRow}>
              <Pressable style={styles.trainingMiniButton} onPress={goHomeWithReverseTransition}>
                <MaterialIcons name="arrow-back" size={20} color="#DCE4EC" />
              </Pressable>
              <Text style={styles.trainingTimer}>Mina pass</Text>
              <View style={styles.trainingTopActionsRight} />
            </View>
          </View>
          <ScrollView contentContainerStyle={styles.listContent}>
            {workoutPlans.length === 0 ? <Text style={styles.loggedSetEmpty}>Inga skapade pass ännu.</Text> : null}
            {workoutPlans.map((plan) => (
              <Pressable key={plan.id} style={styles.trainingCard} onPress={() => openPlanDetail(plan)}>
                <Text style={styles.trainingTitle}>{plan.name}</Text>
                <Button mode="contained" style={styles.savedPlanStartButton} onPress={() => startWorkoutFromPlan(plan)}>
                  Starta pass
                </Button>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {view === 'planDetail' && selectedPlanId ? (() => {
        const plan = workoutPlans.find((p) => p.id === selectedPlanId);
        if (!plan) return null;
        return (
          <View style={styles.screen}>
            <View style={styles.trainingSessionTop}>
              <View style={styles.trainingSessionTopRow}>
                <Pressable style={styles.trainingMiniButton} onPress={goBackToSaved}>
                  <MaterialIcons name="arrow-back" size={20} color="#DCE4EC" />
                </Pressable>
                <Text style={styles.trainingTimer} numberOfLines={1} ellipsizeMode="tail">{plan.name}</Text>
                <View style={styles.trainingTopActionsRight}>
                  <Pressable style={styles.trainingMiniPrimaryButton} onPress={() => loadPlanForEditing(plan)}>
                    <MaterialIcons name="edit" size={20} color="#0F1419" />
                  </Pressable>
                  <Pressable style={styles.trainingMiniDangerButton} onPress={() => confirmDeletePlan(plan.id, plan.name, goBackToSaved)}>
                    <MaterialIcons name="delete-outline" size={20} color="#EF9A9A" />
                  </Pressable>
                </View>
              </View>
            </View>
            <ScrollView contentContainerStyle={styles.listContent}>
              {plan.exercises.length === 0 ? <Text style={styles.loggedSetEmpty}>Inga övningar i passet.</Text> : null}
              {plan.exercises.map((exercise) => {
                const repsArr = getRepsPerSet(exercise);
                const repsLabel = repsArr.length === 1 ? `${repsArr[0]} reps` : `${repsArr.length} set: ${repsArr.join(', ')} reps`;
                return (
                  <View key={exercise.id} style={styles.trainingCard}>
                    <Text style={styles.trainingTitle}>{exercise.name}</Text>
                    <Text style={styles.trainingMeta}>{repsLabel}</Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        );
      })() : null}

      {view === 'pbOverview' ? (
        <View style={styles.screen}>
          <View style={styles.trainingSessionTop}>
            <View style={styles.trainingSessionTopRow}>
              <Pressable style={styles.trainingMiniButton} onPress={goHomeWithReverseTransition}>
                <MaterialIcons name="arrow-back" size={20} color="#DCE4EC" />
              </Pressable>
              <Text style={styles.trainingTimer}>Mina PB&apos;s</Text>
              <View style={styles.trainingTopActionsRight} />
            </View>
          </View>
          <ScrollView contentContainerStyle={styles.listContent}>
            {pbOverviewExercises.length === 0 ? (
              <Text style={styles.loggedSetEmpty}>Inga PB ännu. Spara ett pass med PB för att se listan här.</Text>
            ) : null}
            {pbOverviewExercises.map((item) => (
              <Pressable
                key={`pb-overview-${item.exerciseId}`}
                style={styles.trainingCard}
                onPress={() => openPbModalByExerciseId(item.exerciseId, item.displayName)}
              >
                <Text style={styles.trainingTitle}>{item.displayName}</Text>
                <Text style={styles.trainingMeta}>
                  Vikter: {item.rowsCount} • Högsta reps: {item.bestReps} • Tyngst vikt: {formatWeightKg(weightKeyToKg(item.highestWeightKey))} kg
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {view === 'preloaded' ? (
        <View style={styles.screen}>
          <View style={styles.trainingSessionTop}>
            <View style={styles.trainingSessionTopRow}>
              <Pressable style={styles.trainingMiniButton} onPress={goHomeWithReverseTransition}>
                <MaterialIcons name="arrow-back" size={20} color="#DCE4EC" />
              </Pressable>
              <Text style={styles.trainingTimer}>Förinlagda pass</Text>
              <View style={styles.trainingTopActionsRight} />
            </View>
          </View>
          <ScrollView contentContainerStyle={styles.listContent}>
            <View style={styles.preloadedPlaceholderCard}>
              <MaterialCommunityIcons name="calendar-check" size={48} color="#8FA1B3" />
              <Text style={styles.preloadedPlaceholderTitle}>Förinlagda pass</Text>
              <Text style={styles.preloadedPlaceholderText}>Här kommer förinlagda träningspass att finnas framöver. Du kan då välja färdiga pass och köra igång snabbt.</Text>
            </View>
          </ScrollView>
        </View>
      ) : null}
        </Animated.View>
        {showTransitionPreview ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.trainingPreviewOverlay,
              {
                opacity: transitionPreviewFadeOpacity,
                borderRadius: transitionCornerRadius,
                transform: [
                  { translateX: transitionTranslateX },
                  { translateY: transitionTranslateY },
                  { scaleX: transitionScaleX },
                  { scaleY: transitionScaleY },
                ],
              },
            ]}
          />
        ) : null}
        <Animated.View
          pointerEvents="none"
          style={[styles.trainingBlurOverlay, { opacity: 0 }]}
        >
          <BlurView intensity={42} tint="dark" style={StyleSheet.absoluteFillObject} />
        </Animated.View>
      </View>

      <Modal visible={!!pbModalExercise} transparent animationType="fade" onRequestClose={closePbModal}>
        <View style={styles.timePickerBackdrop}>
          <View style={[styles.timePickerCard, styles.pbModalCard]}>
            <View style={styles.pbModalHeader}>
              <Text style={styles.timePickerTitle}>
                PB per vikt{pbModalExercise ? ` • ${pbModalExercise.name}` : ''}
              </Text>
              <Button compact mode="outlined" textColor="#90CAF9" onPress={cyclePbSortMode}>Sortera: {pbSortLabel}</Button>
            </View>
            <ScrollView style={styles.pbList}>
              {selectedExercisePbRows.map((entry) => (
                <View key={`${entry.exerciseId}-${entry.weightKey}`} style={styles.pbRow}>
                  <Text style={styles.pbRowText}>{formatWeightKg(weightKeyToKg(entry.weightKey))} kg</Text>
                  <Text style={styles.pbRowText}>{entry.bestReps} reps</Text>
                  <Text style={styles.pbRowDate}>{new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short' }).format(new Date(entry.date))}</Text>
                </View>
              ))}
              {selectedExercisePbRows.length === 0 ? (
                <Text style={styles.logEmpty}>Inga PB registrerade för övningen ännu.</Text>
              ) : null}
            </ScrollView>
            <View style={styles.timePickerActions}>
              <Button onPress={closePbModal}>Stäng</Button>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={pbSummaryVisible} transparent animationType="fade" onRequestClose={() => setPbSummaryVisible(false)}>
        <View style={styles.timePickerBackdrop}>
          <View style={[styles.timePickerCard, styles.pbSummaryCard]}>
            <View style={styles.pbSummaryHeaderRow}>
              <View>
                <Text style={styles.pbSummaryTitle}>🏆 Nya PB i passet</Text>
                <Text style={styles.pbSummaryMeta}>{pbSummaryTotal} nya PB</Text>
              </View>
              <Pressable style={styles.pbSummaryCloseButton} onPress={() => setPbSummaryVisible(false)}>
                <MaterialIcons name="close" size={20} color="#DCE4EC" />
              </Pressable>
            </View>
            <ScrollView style={styles.pbSummaryList}>
              {pbSummaryRows.map((event, idx) => (
                <View key={`${event.exerciseName}-${event.weightKg}-${event.newBestReps}-${idx}`} style={styles.pbSummaryRow}>
                  <Text style={styles.pbSummaryExercise}>{event.exerciseName}</Text>
                  <Text style={styles.pbSummaryMainValue}>
                    {formatWeightKg(event.weightKg)} kg × {event.newBestReps} reps
                  </Text>
                  <Text style={styles.pbSummarySubValue}>
                    {event.oldBestReps > 0 ? `Tidigare PB: ${event.oldBestReps} reps` : 'Första PB på vikten'}
                  </Text>
                </View>
              ))}
              {pbSummaryTotal > pbSummaryRows.length ? (
                <Text style={styles.pbSummaryMoreText}>+{pbSummaryTotal - pbSummaryRows.length} fler PB i passet</Text>
              ) : null}
            </ScrollView>
            <View style={styles.timePickerActions}>
              <Button mode="outlined" onPress={() => setPbSummaryVisible(false)}>Stäng</Button>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={builderConfirmVisible} transparent animationType="fade" onRequestClose={() => setBuilderConfirmVisible(false)}>
        <View style={styles.timePickerBackdrop}>
          <View style={[styles.timePickerCard, styles.builderConfirmCard]}>
            <Text style={styles.timePickerTitle}>
              {editingPlanId ? 'Vill du spara ändringarna i passet?' : 'Vill du skapa detta pass?'}
            </Text>
            <View style={styles.builderConfirmSummary}>
              <Text style={styles.builderConfirmPlanName}>
                {builderName.trim() || 'Namnlöst pass'}
              </Text>
              {builderExercises.map((exercise) => {
                const repsArr = getRepsPerSet(exercise);
                const repsLabel = repsArr.length === 1
                  ? `${repsArr[0]} reps`
                  : `${repsArr.length} set: ${repsArr.join(', ')} reps`;
                return (
                  <Text key={exercise.id} style={styles.builderConfirmExerciseRow}>
                    • {exercise.name} — {repsLabel}
                  </Text>
                );
              })}
            </View>
            <View style={styles.timePickerActions}>
              <Button mode="outlined" textColor="#DCE4EC" onPress={() => setBuilderConfirmVisible(false)}>
                Tillbaka
              </Button>
              <Button mode="contained" onPress={saveBuilderPlan}>Spara</Button>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={sessionConfirmVisible} transparent animationType="fade" onRequestClose={() => setSessionConfirmVisible(false)}>
        <View style={styles.timePickerBackdrop}>
          <View style={[styles.timePickerCard, styles.builderConfirmCard]}>
            <Text style={styles.timePickerTitle}>Vill du avsluta och spara passet?</Text>
            <View style={styles.builderConfirmSummary}>
              <Text style={styles.builderConfirmPlanName}>
                {sessionSourcePlanName || `Pass ${formatDuration(elapsedSeconds)}`}
              </Text>
              {sessionExercises.map((exercise) => {
                const setsWithWeight = exercise.sets.filter((s) => s.reps > 0);
                const setsLabel = setsWithWeight.length === 0
                  ? 'Inga set'
                  : `${setsWithWeight.length} set`;
                return (
                  <Text key={exercise.id} style={styles.builderConfirmExerciseRow}>
                    • {exercise.name} — {setsLabel}
                  </Text>
                );
              })}
            </View>
            <View style={styles.timePickerActions}>
              <Button mode="outlined" textColor="#DCE4EC" onPress={() => setSessionConfirmVisible(false)}>
                Tillbaka
              </Button>
              <Button mode="contained" onPress={() => { setSessionConfirmVisible(false); commitCompletedWorkout(); }}>
                Spara pass
              </Button>
            </View>
          </View>
        </View>
      </Modal>

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
              <RNScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.filterRow}
                contentContainerStyle={styles.filterRowContent}
              >
                <Pressable
                  key="gym-body-all"
                  style={[
                    styles.chip,
                    styles.gymFilterChipSmall,
                    gymLibraryFilter === null && styles.chipActive,
                    gymLibraryFilter === null && styles.gymFilterChipActive,
                  ]}
                  onPress={() => setGymLibraryFilter(null)}
                >
                  <Text style={[styles.chipText, styles.gymFilterChipTextSmall, gymLibraryFilter === null && styles.chipTextActive]}>Alla</Text>
                </Pressable>
                {gymBodyPartFilters.map((tag) => {
                  const active = gymLibraryFilter === tag;
                  return (
                    <Pressable
                      key={`gym-body-${tag}`}
                      style={[styles.chip, styles.gymFilterChipSmall, active && styles.chipActive, active && styles.gymFilterChipActive]}
                      onPress={() =>
                        setGymLibraryFilter((prev) => (prev === tag ? null : tag))
                      }
                    >
                      <Text style={[styles.chipText, styles.gymFilterChipTextSmall, active && styles.chipTextActive]}>{tag}</Text>
                    </Pressable>
                  );
                })}
              </RNScrollView>
              <RNScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={[styles.filterRow, styles.filterRowSecond]}
                contentContainerStyle={styles.filterRowContentSecond}
              >
                <Pressable
                  key="gym-equipment-all"
                  style={[
                    styles.chip,
                    styles.gymFilterChipSmall,
                    gymLibraryEquipmentFilter === null && styles.chipActive,
                    gymLibraryEquipmentFilter === null && styles.gymFilterChipActive,
                  ]}
                  onPress={() => setGymLibraryEquipmentFilter(null)}
                >
                  <Text style={[styles.chipText, styles.gymFilterChipTextSmall, gymLibraryEquipmentFilter === null && styles.chipTextActive]}>Alla</Text>
                </Pressable>
                {GYM_EQUIPMENT_TAGS.map((tag) => {
                  const active = gymLibraryEquipmentFilter === tag;
                  return (
                    <Pressable
                      key={`gym-equipment-${tag}`}
                      style={[styles.chip, styles.gymFilterChipSmall, active && styles.chipActive, active && styles.gymFilterChipActive]}
                      onPress={() =>
                        setGymLibraryEquipmentFilter((prev) => (prev === tag ? null : tag))
                      }
                    >
                      <Text style={[styles.chipText, styles.gymFilterChipTextSmall, active && styles.chipTextActive]}>{tag}</Text>
                    </Pressable>
                  );
                })}
              </RNScrollView>
              <FlatList
                style={styles.libraryListScroll}
                data={filteredGymLibrary}
                keyExtractor={(exercise) => `gym-lib-${exercise.id}`}
                keyboardShouldPersistTaps="handled"
                bounces={false}
                overScrollMode="never"
                contentContainerStyle={styles.libraryList}
                ListHeaderComponent={gymLibraryQuery.trim().length > 0 && !hasExactGymMatch ? (
                  <View style={styles.libraryItem}>
                    <View style={styles.libraryItemMain}>
                      <Text style={styles.libraryName}>Vill du lägga till "{gymLibraryQuery.trim()}"?</Text>
                      <View style={styles.libraryTagWrap}>
                        <View style={styles.libraryTag}>
                          <Text style={styles.libraryTagText}>Egen övning</Text>
                        </View>
                      </View>
                    </View>
                    <Button mode="contained" onPress={addCustomGymExercise} contentStyle={styles.libraryItemButton} labelStyle={{ fontSize: 11 }}>
                      Lägg till
                    </Button>
                  </View>
                ) : null}
                ListEmptyComponent={<Text style={styles.logEmpty}>Inga övningar matchar filtret.</Text>}
                renderItem={({ item: exercise }) => (
                  <View style={styles.libraryItem}>
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
                    <Button mode="contained" onPress={() => addLibraryExercise(exercise)} contentStyle={styles.libraryItemButton} labelStyle={{ fontSize: 11 }}>
                      Välj
                    </Button>
                  </View>
                )}
              />
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
                  <Button mode="contained" onPress={addGymCustomCategory}>
                    Lägg till
                  </Button>
                </View>
                <ScrollView style={styles.categoryDialogList} contentContainerStyle={styles.categoryChipListContent}>
                  <Text style={styles.categorySectionLabel}>Muskelgrupp</Text>
                  <View style={styles.categoryChipSection}>
                    <View style={styles.chipWrap}>
                      {gymBodyPartFilters.map((tag) => (
                        <Pressable
                          key={`gym-body-${tag}`}
                          style={[styles.chip, gymCategoryDraftTags.includes(tag) && styles.chipActive]}
                          onPress={() => toggleGymCategoryDraft(tag)}
                        >
                          <Text style={[styles.chipText, gymCategoryDraftTags.includes(tag) && styles.chipTextActive]}>{tag}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                  <Text style={styles.categorySectionLabel}>Utrustning</Text>
                  <View style={styles.categoryChipSection}>
                    <View style={styles.chipWrap}>
                      {GYM_EQUIPMENT_TAGS.map((tag) => (
                        <Pressable
                          key={`gym-equip-${tag}`}
                          style={[styles.chip, gymCategoryDraftTags.includes(tag) && styles.chipActive]}
                          onPress={() => toggleGymCategoryDraft(tag)}
                        >
                          <Text style={[styles.chipText, gymCategoryDraftTags.includes(tag) && styles.chipTextActive]}>{tag}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                  {gymOtherDraftTags.length > 0 ? (
                    <>
                      <Text style={styles.categorySectionLabel}>Övrigt</Text>
                      <View style={styles.categoryChipSection}>
                        <View style={styles.chipWrap}>
                          {gymOtherDraftTags.map((tag) => (
                            <Pressable
                              key={`gym-other-${tag}`}
                              style={[styles.chip, styles.chipActive]}
                              onPress={() => toggleGymCategoryDraft(tag)}
                            >
                              <Text style={[styles.chipText, styles.chipTextActive]}>{tag}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    </>
                  ) : null}
                </ScrollView>
                <View style={styles.timePickerActions}>
                  <Button onPress={closeGymCategoryEditor}>Avbryt</Button>
                  <Button mode="contained" onPress={saveGymCategoryEditor}>Spara</Button>
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
  const insets = useSafeAreaInsets();
  const chartTopPadding = 12;
  const chartBottomPadding = 36;
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
  const dailyTargetByExerciseId = useMemo(
    () =>
      new Map(
        selectedExercises.map((exercise) => [
          exercise.id,
          {
            baseTarget: Math.max(1, exercise.times.length || 0),
            activeDays: new Set(parseDaysLabelToJsDays(exercise.daysLabel)),
          },
        ]),
      ),
    [selectedExercises],
  );
  const dayCounts = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    days.forEach((day) => map.set(formatDateKeyLocal(day), {}));
    logs.forEach((log) => {
      const key = formatDateKeyLocal(new Date(log.atIso));
      const perExercise = map.get(key);
      if (!perExercise) return;
      perExercise[log.exerciseId] = (perExercise[log.exerciseId] || 0) + 1;
    });
    return map;
  }, [days, logs]);
  const maxValue = Math.max(
    1,
    ...selectedExercises.map((exercise) => dailyTargetByExerciseId.get(exercise.id)?.baseTarget || 1),
  );
  const drawableChartHeight = chartHeight - chartTopPadding - chartBottomPadding;
  const segmentGap = 2;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Text style={styles.screenTitleSmall}>Analys</Text>
      <View style={styles.dropdownRow}>
        <Button mode="outlined" textColor="#90CAF9" icon="filter-variant" onPress={() => setMenuOpen(true)}>
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
                  <React.Fragment key={formatDateKeyLocal(day)}>
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
                const counts = dayCounts.get(formatDateKeyLocal(day)) || {};
                const bars = selectedExercises.length || 1;
                const w = (DAY_WIDTH - 12) / bars;
                return selectedExercises.map((exercise, barIndex) => {
                  const value = counts[exercise.id] || 0;
                  const x = index * DAY_WIDTH + 6 + barIndex * w;
                  const barWidth = Math.max(4, w - 2);
                  const targetInfo = dailyTargetByExerciseId.get(exercise.id);
                  const isActiveDay = !!targetInfo && targetInfo.activeDays.has(day.getDay());
                  const targetValue = isActiveDay ? targetInfo?.baseTarget || 1 : 0;
                  const targetY = chartHeight - chartBottomPadding - (targetValue / maxValue) * drawableChartHeight;
                  const unitHeight = drawableChartHeight / maxValue;
                  const segmentHeight = Math.max(2, unitHeight - segmentGap);
                  const segmentCount = Math.max(0, Math.floor(value));
                  return (
                    <React.Fragment key={`${exercise.id}-${formatDateKeyLocal(day)}`}>
                      {Array.from({ length: segmentCount }).map((_, segmentIndex) => {
                        const segmentBottomY = chartHeight - chartBottomPadding - segmentIndex * unitHeight;
                        const y = segmentBottomY - segmentHeight;
                        return <Rect key={`${exercise.id}-${formatDateKeyLocal(day)}-seg-${segmentIndex}`} x={x} y={y} width={barWidth} height={segmentHeight} fill={exercise.color} rx={2} />;
                      })}
                      {targetValue > 0 ? (
                        <Line x1={x} y1={targetY} x2={x + barWidth} y2={targetY} stroke={exercise.color} strokeWidth={1.6} />
                      ) : null}
                    </React.Fragment>
                  );
                });
              })}
            </Svg>
            <View style={styles.axisRow}>
              {days.map((day, index) => {
                const isToday = index === 60;
                return (
                  <View key={`${formatDateKeyLocal(day)}-axis`} style={styles.axisDay}>
                    <Text style={styles.axisWeek}>{swedishWeekday(day)}</Text>
                    <Text style={styles.axisDate}>{shortDate(day)}</Text>
                    <Text style={[styles.axisIdag, isToday && styles.todayText]}>{isToday ? 'Idag' : ''}</Text>
                  </View>
                );
              })}
            </View>
            <Text style={styles.chartHelpText}>Varje segment i stapeln = 1 registrering. Linjen visar dagens mål.</Text>
          </View>
        </ScrollView>
      </View>
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
  const fillAnim = useRef(new Animated.Value(0)).current;
  const thumbAnim = useRef(new Animated.Value(-THUMB_R)).current;
  const trackRef = useRef<View>(null);
  const stateRef = useRef({ w: 0, px: 0, dragging: false, val: value });
  const cbRef = useRef({ onValueChange, onSlidingStart, onSlidingEnd });
  cbRef.current = { onValueChange, onSlidingStart, onSlidingEnd };

  const range = max - min;

  const setPosition = useCallback((pixels: number) => {
    const safePx = Number.isFinite(pixels) ? Math.max(0, Math.min(stateRef.current.w, pixels)) : 0;
    fillAnim.setValue(safePx);
    thumbAnim.setValue(safePx - THUMB_R);
  }, [fillAnim, thumbAnim]);

  const v2p = useCallback((v: number) =>
    range <= 0 ? 0 : ((v - min) / range) * Math.max(0, stateRef.current.w),
  [min, range]);

  const p2v = useCallback((px: number) => {
    const w = stateRef.current.w || 1;
    const f = Math.max(0, Math.min(1, px / w));
    return Math.max(min, Math.min(max, Math.round((min + f * range) / step) * step));
  }, [min, max, range, step]);

  const apply = useCallback((absoluteX: number) => {
    const v = p2v(absoluteX - stateRef.current.px);
    setPosition(v2p(v));
    if (v !== stateRef.current.val) {
      stateRef.current.val = v;
      cbRef.current.onValueChange(v);
    }
  }, [p2v, v2p, setPosition]);

  useEffect(() => {
    if (!stateRef.current.dragging) {
      stateRef.current.val = value;
      setPosition(v2p(value));
    }
  }, [value, v2p, setPosition]);

  const measureTrack = useCallback(() => {
    trackRef.current?.measureInWindow((px, _py, w) => {
      if (!Number.isFinite(px) || !Number.isFinite(w)) return;
      stateRef.current.px = px;
      stateRef.current.w = Math.max(0, w);
      if (!stateRef.current.dragging) setPosition(v2p(stateRef.current.val));
    });
  }, [v2p, setPosition]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((e) => {
          stateRef.current.dragging = true;
          cbRef.current.onSlidingStart?.();
          apply(e.absoluteX);
        })
        .onUpdate((e) => {
          apply(e.absoluteX);
        })
        .onEnd(() => {
          stateRef.current.dragging = false;
          cbRef.current.onSlidingEnd?.();
        })
        .onFinalize(() => {
          if (stateRef.current.dragging) {
            stateRef.current.dragging = false;
            cbRef.current.onSlidingEnd?.();
          }
        }),
    [apply],
  );

  const steps = range <= 0 || step <= 0 ? 1 : Math.max(1, Math.floor(range / step));
  const valueRatio = range <= 0 ? 0 : (value - min) / range;

  return (
    <GestureDetector gesture={panGesture}>
      <View ref={trackRef} onLayout={measureTrack} style={{ height: SLIDER_HIT, justifyContent: 'center' }}>
        {/* Track background */}
        <View style={{ height: TRACK_H, borderRadius: TRACK_H / 2, backgroundColor: '#2C3A49' }} />
        {/* Step dots */}
        <View style={{ position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', top: (SLIDER_HIT - 4) / 2 }}>
          {Array.from({ length: steps + 1 }, (_, i) => (
            <View
              key={i}
              style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: i / steps <= valueRatio ? '#7BA4CC' : '#3D4F5F' }}
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
            width: fillAnim,
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
            transform: [{ translateX: thumbAnim }],
            ...Platform.select({
              ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 4 },
              android: { elevation: 4 },
            }),
          }}
        />
      </View>
    </GestureDetector>
  );
}

function DiaryScreen({
  series,
  setSeries,
}: {
  series: PainSeries[];
  setSeries: React.Dispatch<React.SetStateAction<PainSeries[]>>;
}) {
  const insets = useSafeAreaInsets();
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(series[0]?.id ?? null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<DiaryViewMode>('dag');
  const [month, setMonth] = useState(monthTitle(new Date()));
  const [viewportWidth, setViewportWidth] = useState(Dimensions.get('window').width - 32);
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 0]);
  const [scrollLocked, setScrollLocked] = useState(false);
  const chartScrollRef = useRef<ScrollView>(null);
  const diaryScrollRef = useRef<RNScrollView>(null);
  const logRowYById = useRef<Record<string, number>>({});
  const logRowHeightById = useRef<Record<string, number>>({});
  const logWrapY = useRef(0);
  const suppressNextDeselect = useRef(false);
  const diaryScrollY = useRef(0);
  const chartTouchStart = useRef<{ x: number; y: number } | null>(null);
  const chartTouchMoved = useRef(false);
  const prevPointsLengthRef = useRef(0);

  useEffect(() => {
    if (!activeSeriesId && series[0]) setActiveSeriesId(series[0].id);
  }, [activeSeriesId, series]);

  const active = series.find((item) => item.id === activeSeriesId) || series[0];
  // Sortera äldst först så att nyaste punkt hamnar längst till höger
  const allPoints = useMemo(() => {
    if (!active) return [];
    const nowMs = Date.now();
    return active.entries
      .map((entry) => {
        const day = new Date(entry.atIso);
        if (Number.isNaN(day.getTime()) || day.getTime() > nowMs) return null;
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

  // Scrolla så att högerkanten (nyaste datum) visas – äldsta vänster, nyaste höger
  const didAddPoint = points.length > prevPointsLengthRef.current;
  if (didAddPoint) prevPointsLengthRef.current = points.length;
  useEffect(() => {
    const x = Math.max(0, chartWidth - viewportWidth);
    const id = setTimeout(() => {
      chartScrollRef.current?.scrollTo({ x, animated: didAddPoint });
      setVisibleRange([x, x + viewportWidth]);
      if (points.length > 0) {
        setMonth(monthTitle(points[points.length - 1].day));
      }
    }, didAddPoint ? 120 : 80);
    return () => clearTimeout(id);
  }, [viewportWidth, chartWidth, points, didAddPoint]);

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
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Text style={styles.screenTitleSmall}>Dagbok</Text>
      <RNScrollView
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
          <View
            key={item.id}
            style={[styles.seriesCard, active?.id === item.id && styles.activeSeriesCard]}
          >
            <Pressable onPress={() => setActiveSeriesId(item.id)}>
              <View style={styles.seriesHeader}>
                <Text style={styles.seriesTitle}>{item.name}</Text>
                <Pressable onPress={() => setSeries((prev) => prev.filter((s) => s.id !== item.id))}>
                  <MaterialIcons name="delete" size={24} color="#EF9A9A" />
                </Pressable>
              </View>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.value}</Text>
              </View>
            </Pressable>
            <SmoothSlider
              min={1}
              max={10}
              step={1}
              value={item.value}
              onValueChange={(v) =>
                setSeries((prev) => prev.map((s) => (s.id === item.id ? { ...s, value: v } : s)))
              }
              onSlidingStart={() => { setActiveSeriesId(item.id); setScrollLocked(true); }}
              onSlidingEnd={() => setScrollLocked(false)}
            />
            <TextInput
              value={item.draftNote}
              onChangeText={(text) => setSeries((prev) => prev.map((s) => (s.id === item.id ? { ...s, draftNote: text } : s)))}
              onFocus={() => setActiveSeriesId(item.id)}
              style={[styles.input, styles.noteInput]}
              placeholder="Hur mår du just nu?"
              placeholderTextColor={PLACEHOLDER_COLOR}
              multiline
            />
            <Pressable style={styles.seriesButtons} onPress={() => setActiveSeriesId(item.id)}>
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
            </Pressable>
          </View>
        ))}

        <View style={styles.diaryChartHeader}>
          <Text style={[styles.monthTitle, styles.diaryMonthTitle]}>{month}</Text>
          <View style={styles.diaryViewButtonWrap}>
            <Button
              mode="outlined"
              compact
              textColor="#90CAF9"
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
      </RNScrollView>
    </View>
  );
}

const TAB_PILL_WIDTH = 52;
const TAB_PILL_HEIGHT = 52;
const TAB_BAR_PADDING_H = 14;

function FloatingTabBar({
  state,
  navigation,
  hasActiveWorkout,
}: {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: { emit: (opts: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean }; navigate: (name: string) => void };
  hasActiveWorkout: boolean;
}) {
  const [tabBarWidth, setTabBarWidth] = useState(0);
  const pillTranslateX = useRef(new Animated.Value(0)).current;
  const prevIndexRef = useRef(state.index);
  const workoutPulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!hasActiveWorkout) {
      workoutPulseAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(workoutPulseAnim, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(workoutPulseAnim, { toValue: 0.15, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [hasActiveWorkout, workoutPulseAnim]);

  const getPillTranslateX = useCallback((index: number) => {
    if (tabBarWidth <= 0) return 0;
    const contentWidth = tabBarWidth - TAB_BAR_PADDING_H * 2;
    const tabWidth = contentWidth / state.routes.length;
    const centerX = TAB_BAR_PADDING_H + tabWidth * (index + 0.5);
    return centerX - TAB_PILL_WIDTH / 2;
  }, [tabBarWidth, state.routes.length]);

  useEffect(() => {
    if (tabBarWidth <= 0) return;
    const targetX = getPillTranslateX(state.index);
    if (prevIndexRef.current === state.index) {
      pillTranslateX.setValue(targetX);
    } else {
      prevIndexRef.current = state.index;
      Animated.spring(pillTranslateX, {
        toValue: targetX,
        useNativeDriver: true,
        damping: 25,
        stiffness: 400,
      }).start();
    }
  }, [state.index, tabBarWidth, getPillTranslateX, pillTranslateX]);

  const handleLayout = useCallback((e: { nativeEvent: { layout: { width: number } } }) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && tabBarWidth !== w) {
      setTabBarWidth(w);
      const initialX = TAB_BAR_PADDING_H + (w - TAB_BAR_PADDING_H * 2) / state.routes.length * (state.index + 0.5) - TAB_PILL_WIDTH / 2;
      pillTranslateX.setValue(initialX);
    }
  }, [state.index, state.routes.length, tabBarWidth, pillTranslateX]);

  return (
    <View style={styles.floatingTabBarOuter} pointerEvents="box-none">
      <View style={styles.floatingTabBar} onLayout={handleLayout}>
        <Animated.View
          style={[
            styles.floatingTabPillSliding,
            { transform: [{ translateX: pillTranslateX }] },
          ]}
          pointerEvents="none"
        />
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const iconColor = isFocused ? '#1A222C' : '#90A4B8';
          const IconComponent = route.name === 'Träning' ? MaterialCommunityIcons : MaterialIcons;
          const iconName =
            route.name === 'Hem' ? 'home'
            : route.name === 'Analys' ? 'bar-chart'
            : route.name === 'Träning' ? 'dumbbell'
            : 'menu-book';
          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name as never);
              }}
              style={styles.floatingTabBarItem}
            >
              <View style={styles.floatingTabPill}>
                {route.name === 'Träning' && hasActiveWorkout ? (
                  <Animated.View
                    style={[styles.workoutActiveRing, { opacity: workoutPulseAnim }]}
                    pointerEvents="none"
                  />
                ) : null}
                <IconComponent name={iconName as never} size={24} color={iconColor} />
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'Hem' | 'Träning' | 'Analys' | 'Dagbok'>('Hem');
  const [tabTransitionDirection, setTabTransitionDirection] = useState<TabTransitionDirection>(null);
  const prevTabIndexRef = useRef(0);

  const clearTabTransitionDirection = useCallback(() => setTabTransitionDirection(null), []);
  const tabTransitionContextValue = useMemo(
    () => ({ direction: tabTransitionDirection, clearDirection: clearTabTransitionDirection }),
    [tabTransitionDirection, clearTabTransitionDirection]
  );
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
    { id: 'p1', name: 'Nacke', value: 4, draftNote: '', entries: [] },
    { id: 'p2', name: 'Ländrygg', value: 3, draftNote: '', entries: [] },
  ]);
  const [workoutPlans, setWorkoutPlans] = useState<WorkoutPlan[]>([]);
  const [completedWorkouts, setCompletedWorkouts] = useState<CompletedWorkout[]>([]);
  const [exerciseWeightPbs, setExerciseWeightPbs] = useState<ExerciseWeightPb[]>([]);
  const [rehabLibraryExercises, setRehabLibraryExercises] = useState<LibraryExercise[]>(LIBRARY_EXERCISES);
  const [gymLibraryExercises, setGymLibraryExercises] = useState<LibraryExercise[]>(GYM_LIBRARY_EXERCISES);
  const [newSeriesDialog, setNewSeriesDialog] = useState(false);
  const [newSeriesName, setNewSeriesName] = useState('');
  const [libraryVisible, setLibraryVisible] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryFilter, setLibraryFilter] = useState<string | null>(null);
  const [wizardExercise, setWizardExercise] = useState<LibraryExercise | null>(null);
  const [wizardMode, setWizardMode] = useState<WizardMode>('create');
  const [wizardExerciseId, setWizardExerciseId] = useState<string | null>(null);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardDays, setWizardDays] = useState<WeekdayKey[]>([]);
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
  const trainingFabActionRef = useRef<(() => void) | null>(null);
  const [hasActiveWorkout, setHasActiveWorkout] = useState(false);
  const librarySheetMaxDrag = Math.round(Dimensions.get('window').height * 0.92);
  const librarySheetTranslateY = useRef(new Animated.Value(0)).current;
  const librarySheetStartY = useRef(0);

  useEffect(() => {
    const loadPersistedState = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        let parsed: Partial<PersistedState> = {};
        if (raw) {
          parsed = JSON.parse(raw) as PersistedState;
          if (Array.isArray(parsed.exercises)) setExercises(parsed.exercises);
          if (Array.isArray(parsed.logs)) setLogs(parsed.logs);
          if (Array.isArray(parsed.painSeries)) {
            setPainSeries(
              parsed.painSeries.map((item) => {
                const rawEntries = Array.isArray(item.entries) ? item.entries : [];
                if (item.id === 'p1') {
                  return { ...item, entries: stripSeedEntries(rawEntries, 'nacke') };
                }
                if (item.id === 'p2') {
                  return { ...item, entries: stripSeedEntries(rawEntries, 'rygg') };
                }
                return { ...item, entries: rawEntries };
              }),
            );
          }
          if (Array.isArray(parsed.workoutPlans)) setWorkoutPlans(parsed.workoutPlans);
          if (Array.isArray(parsed.completedWorkouts)) setCompletedWorkouts(parsed.completedWorkouts);
          if (Array.isArray(parsed.exerciseWeightPbs)) setExerciseWeightPbs(parsed.exerciseWeightPbs);
          if (Array.isArray(parsed.rehabLibraryExercises)) setRehabLibraryExercises(parsed.rehabLibraryExercises);
          if (Array.isArray(parsed.gymLibraryExercises)) setGymLibraryExercises(mergeGymLibrary(parsed.gymLibraryExercises));
        }
        // Re-read logs from storage in case background actions wrote new logs.
        try {
          const freshRaw = await AsyncStorage.getItem(STORAGE_KEY);
          if (freshRaw) {
            const freshParsed = JSON.parse(freshRaw) as PersistedState;
            if (Array.isArray(freshParsed.logs) && freshParsed.logs.length > (parsed.logs?.length ?? 0)) {
              setLogs(freshParsed.logs);
            }
          }
        } catch { /* ignore */ }
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
      exerciseWeightPbs,
      rehabLibraryExercises,
      gymLibraryExercises,
    };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch(() => {
      // Ignore temporary storage failures.
    });
  }, [exercises, logs, painSeries, workoutPlans, completedWorkouts, exerciseWeightPbs, rehabLibraryExercises, gymLibraryExercises, isHydrated]);

  /* ── Deep link import handler ── */
  const pendingDeepLinkRef = useRef<string | null>(null);
  const isHydratedRef = useRef(false);
  useEffect(() => { isHydratedRef.current = isHydrated; }, [isHydrated]);

  function handleImportUrl(url: string) {
    try {
      const parsed = Linking.parse(url);
      const type = parsed.queryParams?.type as string | undefined;
      const data = parsed.queryParams?.data as string | undefined;
      if (!type || !data) return;

      // Decode base64 → gunzip → UTF-8 string
      const { gunzipSync, strFromU8 } = require('fflate') as typeof import('fflate');
      const binary = atob(data);
      const compressed = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) compressed[i] = binary.charCodeAt(i);
      const json = strFromU8(gunzipSync(compressed));

      function makeId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

      // Expand short-key Exercise format → full Exercise object
      // Supports both old full-key format and new short-key format.
      // Short keys: t=title, l=libraryExerciseId(ignored—title already set), d=description,
      //             c=color, dl=daysLabel, s=sets, r=reps, tm=times, ro=remindersOn(0/1)
      function expandExercise(raw: Record<string, unknown>): Exercise {
        return {
          id: `ex_${makeId()}`,
          title: (raw.t || raw.title || '') as string,
          description: (raw.d || raw.description || '') as string,
          color: (raw.c || raw.color || '#5E81AC') as string,
          daysLabel: (raw.dl || raw.daysLabel || 'Alla dagar') as string,
          sets: (raw.s ?? raw.sets ?? 3) as number,
          reps: (raw.r ?? raw.reps ?? 10) as number,
          times: (raw.tm || raw.times || []) as string[],
          remindersOn: raw.ro !== undefined
            ? Boolean(raw.ro)
            : raw.remindersOn !== undefined ? Boolean(raw.remindersOn) : true,
        };
      }

      // Expand short-key WorkoutPlan format → full WorkoutPlan object
      // Short keys: i=id, n=name, e=exercises, l=libraryExerciseId (number 1..N eller string), n=custom name, s=sets, r=reps, rp=repsPerSet
      function expandPlan(raw: Record<string, unknown>): WorkoutPlan {
        const rawExercises = (raw.e || raw.exercises || []) as Record<string, unknown>[];
        const libList = gymLibraryExercisesRef.current;
        const planExercises: WorkoutPlanExercise[] = rawExercises.map((ex) => {
          const lVal = ex.l ?? ex.libraryExerciseId;
          let libId: string | undefined;
          let libName: string | undefined;
          if (typeof lVal === 'number') {
            const lib = libList[lVal - 1];
            if (lib) {
              libId = lib.id;
              libName = lib.name;
            }
          } else if (typeof lVal === 'string') {
            libId = lVal;
            libName = libList.find((e) => e.id === libId)?.name;
          }
          const customName = (ex.n ?? ex.name ?? '') as string;
          const s = (ex.s ?? ex.sets ?? 3) as number;
          const r = (ex.r ?? ex.reps ?? 10) as number;
          const rp = (ex.rp ?? ex.repsPerSet) as number[] | undefined;
          const repsPerSet = Array.isArray(rp) && rp.length > 0 ? rp : Array(s).fill(r);
          return {
            id: `ex_${makeId()}`,
            libraryExerciseId: libId,
            name: libName || customName,
            sets: repsPerSet.length,
            reps: repsPerSet[0] ?? r,
            repsPerSet,
          };
        });
        return {
          id: ((raw.i || raw.id) as string | undefined) || `plan_${makeId()}`,
          name: (raw.n || raw.name || '') as string,
          exercises: planExercises,
          createdAtIso: (raw.createdAtIso as string | undefined) || new Date().toISOString(),
        };
      }

      if (type === 'exercises') {
        const rawList = JSON.parse(json) as Record<string, unknown>[];
        const imported = rawList.map(expandExercise);
        Alert.alert(
          'Importera övningar',
          `Importera ${imported.length} övning${imported.length !== 1 ? 'ar' : ''} från terapeuten?\n\nDina nuvarande dagliga övningar ersätts.`,
          [
            { text: 'Avbryt', style: 'cancel' },
            { text: 'Importera', onPress: () => setExercises(imported) },
          ]
        );
      } else if (type === 'workoutplan') {
        const plan = expandPlan(JSON.parse(json) as Record<string, unknown>);
        Alert.alert(
          'Importera träningspass',
          `Importera passet "${plan.name}"?`,
          [
            { text: 'Avbryt', style: 'cancel' },
            {
              text: 'Importera',
              onPress: () =>
                setWorkoutPlans((prev) => {
                  const idx = prev.findIndex((p) => p.id === plan.id);
                  if (idx >= 0) return prev.map((p) => (p.id === plan.id ? plan : p));
                  return [...prev, plan];
                }),
            },
          ]
        );
      } else if (type === 'workoutplans') {
        const rawList = JSON.parse(json) as Record<string, unknown>[];
        const imported = rawList.map(expandPlan);
        Alert.alert(
          'Importera träningspass',
          `Importera ${imported.length} träningspass från terapeuten?`,
          [
            { text: 'Avbryt', style: 'cancel' },
            {
              text: 'Importera',
              onPress: () =>
                setWorkoutPlans((prev) => {
                  const merged = [...prev];
                  for (const plan of imported) {
                    const idx = merged.findIndex((p) => p.id === plan.id);
                    if (idx >= 0) merged[idx] = plan;
                    else merged.push(plan);
                  }
                  return merged;
                }),
            },
          ]
        );
      }
    } catch {
      // Ignore malformed or unsupported links
    }
  }

  // Capture any link that arrives before state is hydrated
  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (url) pendingDeepLinkRef.current = url;
    });
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (isHydratedRef.current) {
        handleImportUrl(url);
      } else {
        pendingDeepLinkRef.current = url;
      }
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Process any link that was captured before hydration finished
  useEffect(() => {
    if (!isHydrated) return;
    const url = pendingDeepLinkRef.current;
    if (url) {
      pendingDeepLinkRef.current = null;
      handleImportUrl(url);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated]);

  /* ── Notification: refs for latest state (used inside listeners) ── */
  const exercisesRef = useRef(exercises);
  exercisesRef.current = exercises;
  const logsRef = useRef(logs);
  logsRef.current = logs;
  const gymLibraryExercisesRef = useRef(gymLibraryExercises);
  gymLibraryExercisesRef.current = gymLibraryExercises;

  /* ── Notification: request Android permissions ── */
  useEffect(() => {
    (async () => {
      if (!Device.isDevice || Platform.OS !== 'android') return;
      await requestAndroidNotificationPermission();
      await ensureAndroidExactAlarmPermission();
    })();
  }, []);

  /* ── Android native notifications: consume actions done while app was backgrounded ── */
  useEffect(() => {
    if (!isHydrated || Platform.OS !== 'android') return;
    (async () => {
      const pending = await consumeAndroidPendingCompletions().catch(() => []);
      if (!Array.isArray(pending) || pending.length === 0) return;
      const incoming: ExerciseLog[] = pending
        .filter((row) => row?.exerciseId && row?.atIso)
        .map((row) => ({ exerciseId: row.exerciseId, atIso: row.atIso }));
      if (incoming.length === 0) return;
      setLogs((prev) => mergeLogs(prev, incoming));
    })();
  }, [isHydrated]);

  /* ── Notification: schedule / reschedule whenever exercises or logs change ── */
  useEffect(() => {
    if (!isHydrated) return;
    // Schedule immediately when hydrated so OS has notifications even if app is closed quickly
    scheduleExerciseNotifications(exercises).catch((error) => {
      console.warn('[notifications] initial schedule failed:', error);
    });
    // Debounce reschedule on subsequent changes to avoid excessive rescheduling
    const timer = setTimeout(() => {
      scheduleExerciseNotifications(exercises).catch((error) => {
        console.warn('[notifications] debounced schedule failed:', error);
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [exercises, logs, isHydrated]);

  /* ── Notification: reschedule + reload logs when app comes to foreground ── */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'active' && isHydrated) {
        let freshLogs: ExerciseLog[] = logsRef.current;
        try {
          const raw = await AsyncStorage.getItem(STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as PersistedState;
            if (Array.isArray(parsed.logs)) {
              freshLogs = parsed.logs;
              setLogs(parsed.logs);
            }
          }
        } catch { /* ignore */ }
        if (Platform.OS === 'android') {
          const pending = await consumeAndroidPendingCompletions().catch(() => []);
          if (Array.isArray(pending) && pending.length > 0) {
            const incoming: ExerciseLog[] = pending
              .filter((row) => row?.exerciseId && row?.atIso)
              .map((row) => ({ exerciseId: row.exerciseId, atIso: row.atIso }));
            if (incoming.length > 0) {
              freshLogs = mergeLogs(freshLogs, incoming);
              setLogs(freshLogs);
            }
          }
        }
        scheduleExerciseNotifications(exercisesRef.current).catch((error) => {
          console.warn('[notifications] app-active schedule failed:', error);
        });
      }
    });
    return () => subscription.remove();
  }, [isHydrated]);

  const closeTimePicker = () => setTimePickerIndex(null);
  const setTrainingFabAction = useCallback((action: (() => void) | null) => {
    trainingFabActionRef.current = action;
  }, []);
  const openLibrarySheet = useCallback(() => {
    librarySheetTranslateY.setValue(80);
    setLibraryQuery('');
    setLibraryFilter(null);
    setLibraryVisible(true);
  }, [librarySheetTranslateY]);
  useEffect(() => {
    if (libraryVisible) {
      Animated.spring(librarySheetTranslateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 22,
        stiffness: 220,
      }).start();
    }
  }, [libraryVisible, librarySheetTranslateY]);
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
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onMoveShouldSetPanResponderCapture: (_, gesture) => Math.abs(gesture.dy) > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
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
    setWizardDays([]);
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
      const matchesFilter = !libraryFilter || exercise.tags.includes(libraryFilter);
      return matchesQuery && matchesFilter;
    });
  }, [libraryFilter, libraryQuery, rehabLibraryExercises]);
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
    setLibraryFilter(null);
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
    setWizardDays(parsedDays.length > 0 ? parsedDays : [getTodayWeekdayKey()]);
    setWizardSets(`${Math.max(1, exercise.sets || 1)}`);
    setWizardReps(`${Math.max(1, exercise.reps || 1)}`);
    setWizardWeight(typeof exercise.weightKg === 'number' ? `${exercise.weightKg}` : '');
    setWizardTimesPerDay(`${Math.max(1, exercise.times.length || 1)}`);
    setWizardTimes(exercise.times.length > 0 ? exercise.times : ['09:00']);
  };
  const globalPlusColor =
    activeTab === 'Hem'
      ? '#A5D6A7'
      : activeTab === 'Träning'
        ? '#81C784'
        : activeTab === 'Analys'
          ? '#90CAF9'
          : '#FFE082';
  const onGlobalPlusPress = useCallback(() => {
    if (activeTab === 'Hem') {
      openLibrarySheet();
      return;
    }
    if (activeTab === 'Träning') {
      trainingFabActionRef.current?.();
      return;
    }
    if (activeTab === 'Dagbok') {
      setNewSeriesDialog(true);
    }
  }, [activeTab, openLibrarySheet]);
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
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: APP_BG_COLOR }}>
      <PaperProvider theme={paperTheme}>
        <NavigationContainer
          theme={navigationTheme}
          onStateChange={(state) => {
            if (!state) return;
            const routeName = state.routes?.[state.index ?? 0]?.name;
            if (routeName === 'Hem' || routeName === 'Träning' || routeName === 'Analys' || routeName === 'Dagbok') {
              const newIndex = state.index ?? 0;
              const prevIndex = prevTabIndexRef.current;
              if (newIndex !== prevIndex) {
                setTabTransitionDirection(newIndex > prevIndex ? 'right' : 'left');
                prevTabIndexRef.current = newIndex;
              }
              setActiveTab(routeName);
            }
          }}
        >
          <StatusBar style="light" />
          <TabTransitionContext.Provider value={tabTransitionContextValue}>
            <Tab.Navigator
              screenOptions={{
                headerShown: false,
                tabBarStyle: { display: 'none' },
                sceneStyle: { backgroundColor: APP_BG_COLOR },
                freezeOnBlur: false,
              }}
              tabBar={({ state, navigation }) => <FloatingTabBar state={state} navigation={navigation} hasActiveWorkout={hasActiveWorkout} />}
            >
              <Tab.Screen
                name="Hem"
                options={{ title: 'Hem' }}
              >
                {() => (
                  <AnimatedTabScreen>
                    <HomeScreen
                      exercises={exercises}
                      setExercises={setExercises}
                      onQuickLog={(exerciseId) => setLogs((prev) => [...prev, { exerciseId, atIso: new Date().toISOString() }])}
                      onEditExercise={openEditWizard}
                      onDeleteExercise={(exercise) => setDeleteDialogExercise(exercise)}
                    />
                  </AnimatedTabScreen>
                )}
              </Tab.Screen>
              <Tab.Screen name="Träning" options={{ title: 'Träning' }}>
                {() => (
                  <AnimatedTabScreen>
                    <TrainingScreen
                      workoutPlans={workoutPlans}
                      setWorkoutPlans={setWorkoutPlans}
                      completedWorkouts={completedWorkouts}
                      setCompletedWorkouts={setCompletedWorkouts}
                      exerciseWeightPbs={exerciseWeightPbs}
                      setExerciseWeightPbs={setExerciseWeightPbs}
                      gymLibraryExercises={gymLibraryExercises}
                      setGymLibraryExercises={setGymLibraryExercises}
                      onFabActionChange={setTrainingFabAction}
                      onActiveSessionChange={setHasActiveWorkout}
                    />
                  </AnimatedTabScreen>
                )}
              </Tab.Screen>
              <Tab.Screen name="Analys" options={{ title: 'Analys' }}>
                {() => (
                  <AnimatedTabScreen>
                    <AnalysisScreen exercises={exercises} logs={logs} />
                  </AnimatedTabScreen>
                )}
              </Tab.Screen>
              <Tab.Screen name="Dagbok" options={{ title: 'Dagbok' }}>
                {() => (
                  <AnimatedTabScreen>
                    <DiaryScreen series={painSeries} setSeries={setPainSeries} />
                  </AnimatedTabScreen>
                )}
              </Tab.Screen>
            </Tab.Navigator>
          </TabTransitionContext.Provider>
          <Pressable
            accessibilityRole="button"
            onPress={onGlobalPlusPress}
            style={[styles.navPlusButton, { backgroundColor: globalPlusColor }]}
          >
            <MaterialIcons name="add" size={32} color="#0F1419" />
          </Pressable>
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
              <RNScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.filterRow}
                contentContainerStyle={styles.filterRowContent}
              >
                <Pressable
                  key="rehab-filter-all"
                  style={[
                    styles.chip,
                    styles.gymFilterChipSmall,
                    libraryFilter === null && styles.chipActive,
                    libraryFilter === null && styles.gymFilterChipActive,
                  ]}
                  onPress={() => setLibraryFilter(null)}
                >
                  <Text style={[styles.chipText, styles.gymFilterChipTextSmall, libraryFilter === null && styles.chipTextActive]}>Alla</Text>
                </Pressable>
                {rehabBodyPartFilters.map((tag) => {
                  const active = libraryFilter === tag;
                  return (
                    <Pressable
                      key={tag}
                      style={[styles.chip, styles.gymFilterChipSmall, active && styles.chipActive, active && styles.gymFilterChipActive]}
                      onPress={() =>
                        setLibraryFilter((prev) => (prev === tag ? null : tag))
                      }
                    >
                      <Text style={[styles.chipText, styles.gymFilterChipTextSmall, active && styles.chipTextActive]}>{tag}</Text>
                    </Pressable>
                  );
                })}
              </RNScrollView>
              <FlatList
                style={styles.libraryListScroll}
                data={filteredLibrary}
                keyExtractor={(exercise) => exercise.id}
                keyboardShouldPersistTaps="handled"
                bounces={false}
                overScrollMode="never"
                contentContainerStyle={styles.libraryList}
                ListHeaderComponent={libraryQuery.trim().length > 0 && !hasExactRehabMatch ? (
                  <View style={styles.libraryItem}>
                    <View style={styles.libraryItemMain}>
                      <Text style={styles.libraryName}>Vill du lägga till "{libraryQuery.trim()}"?</Text>
                      <View style={styles.libraryTagWrap}>
                        <View style={styles.libraryTag}>
                          <Text style={styles.libraryTagText}>Egen övning</Text>
                        </View>
                      </View>
                    </View>
                    <Button mode="contained" onPress={addCustomRehabExercise} contentStyle={styles.libraryItemButton} labelStyle={{ fontSize: 11 }}>
                      Lägg till
                    </Button>
                  </View>
                ) : null}
                ListEmptyComponent={<Text style={styles.logEmpty}>Inga övningar matchar filtret.</Text>}
                renderItem={({ item: exercise }) => (
                  <View style={styles.libraryItem}>
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
                      mode="contained"
                      onPress={() => {
                        librarySheetTranslateY.setValue(0);
                        setLibraryVisible(false);
                        setWizardExercise(exercise);
                        setWizardMode('create');
                        setWizardExerciseId(null);
                        setWizardStep(0);
                      }}
                      contentStyle={styles.libraryItemButton}
                      labelStyle={{ fontSize: 11 }}
                    >
                      Välj
                    </Button>
                  </View>
                )}
              />
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
                    <Button mode="contained" onPress={addRehabCustomCategory}>
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
                    <Button mode="contained" onPress={saveRehabCategoryEditor}>Spara</Button>
                  </View>
                </View>
              </View>
            )}
          </View>
        </Modal>

        <Modal visible={!!wizardExercise} transparent animationType="slide" onRequestClose={resetWizard}>
          <View style={styles.bottomSheetBackdrop}>
            <Pressable style={styles.backdropTapZone} onPress={resetWizard} />
            <View style={[styles.bottomSheet, styles.wizardBottomSheet]}>
              <View style={styles.bottomSheetHandle} />
              <Text style={styles.bottomSheetTitle}>
                {wizardMode === 'edit' ? 'Redigera plan' : 'Skapa plan'}: {wizardExercise?.name}
              </Text>
              <Text style={styles.wizardStepLabel}>Steg {wizardStep + 1} av 3</Text>
              <View style={styles.wizardContentArea}>
              {wizardStep === 0 ? (
                <View style={styles.wizardBlock}>
                  <Text style={styles.wizardSectionTitle}>1) Välj dagar</Text>
                  <Pressable
                    style={[styles.chip, styles.varjeDagChip, wizardDays.length === 7 && styles.chipActive]}
                    onPress={() =>
                      setWizardDays((prev) =>
                        prev.length === 7 ? [] : WEEKDAY_CHIPS.map((d) => d.key),
                      )
                    }
                  >
                    <Text style={[styles.chipText, wizardDays.length === 7 && styles.chipTextActive]}>Varje dag</Text>
                  </Pressable>
                  <View style={styles.dayRowsWrap}>
                    <View style={styles.chipWrapSingleRow}>
                      {WEEKDAY_CHIPS.slice(0, 5).map((day) => {
                        const active = wizardDays.includes(day.key);
                        return (
                          <Pressable
                            key={day.key}
                            style={[styles.chip, styles.dayChip, active && styles.chipActive]}
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
                    <View style={[styles.chipWrapSingleRow, styles.chipWrapWeekendRow]}>
                      {WEEKDAY_CHIPS.slice(5, 7).map((day) => {
                        const active = wizardDays.includes(day.key);
                        return (
                          <Pressable
                            key={day.key}
                            style={[styles.chip, styles.dayChipWeekend, active && styles.chipActive]}
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
              </View>
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
                      const activeDays: WeekdayKey[] = wizardDays.length === 0 ? [getTodayWeekdayKey()] : wizardDays;
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
                        const updatedExercises = exercises.map((item) =>
                          item.id === wizardExerciseId ? { ...item, ...nextExercisePatch } : item,
                        );
                        setExercises(updatedExercises);
                        resetWizard();
                        scheduleExerciseNotifications(updatedExercises).catch((error) => {
                          console.warn('[notifications] wizard save schedule failed:', error);
                        });
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
                mode="contained"
                buttonColor="#C62828"
                textColor="#FFEBEE"
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
                mode="contained"
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
  floatingTabBarOuter: {
    position: 'absolute',
    bottom: 28,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  floatingTabBar: {
    width: '90%',
    height: 78,
    backgroundColor: '#151D26',
    borderRadius: 39,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 14,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
  },
  floatingTabBarItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingTabBarIconWrap: {
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  floatingTabPill: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workoutActiveRing: {
    position: 'absolute',
    top: -3,
    left: -3,
    right: -3,
    bottom: -3,
    borderRadius: 29,
    borderWidth: 2,
    borderColor: '#EF5350',
  },
  floatingTabPillSliding: {
    position: 'absolute',
    left: 0,
    top: 13,
    width: TAB_PILL_WIDTH,
    height: TAB_PILL_HEIGHT,
    borderRadius: TAB_PILL_HEIGHT / 2,
    backgroundColor: '#2563A8',
  },
  floatingTabPillActive: {
    backgroundColor: '#2563A8',
    borderRadius: 26,
  },
  navPlusButton: {
    position: 'absolute',
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    bottom: 82,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#0F1419',
    zIndex: 60,
    elevation: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.32,
    shadowRadius: 10,
  },
  screen: { flex: 1, backgroundColor: '#0F1419' },
  screenTitle: { color: '#E3EAF2', fontSize: 32, fontWeight: '800', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  minimalTriggerTestButton: { alignSelf: 'flex-start', marginHorizontal: 16, marginBottom: 8, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#33414F', borderRadius: 8 },
  minimalTriggerTestText: { color: '#88C0D0', fontSize: 13 },
  screenTitleSmall: { color: '#E3EAF2', fontSize: 24, fontWeight: '700', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
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
    minHeight: '92%',
    maxHeight: '92%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 0,
  },
  libraryBottomSheet: {
    minHeight: '92%',
    maxHeight: '92%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
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
  bottomSheetTitle: { color: '#E3EAF2', fontSize: 18, fontWeight: '700' },
  librarySearch: { marginTop: 6 },
  filterRow: { marginTop: 6, flexGrow: 0 },
  filterRowSecond: { marginTop: 0 },
  filterRowContent: { paddingVertical: 6, gap: 8, paddingRight: 12, alignItems: 'center' },
  filterRowContentSecond: { paddingTop: 0, paddingBottom: 6, gap: 8, paddingRight: 12, alignItems: 'center' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipWrapSingleRow: { flexDirection: 'row', flexWrap: 'nowrap', gap: 6, marginTop: 8 },
  chipWrapWeekendRow: { justifyContent: 'center' },
  dayRowsWrap: { gap: 6 },
  varjeDagChip: { alignSelf: 'flex-start' },
  dayChip: { flex: 1, minWidth: 0, justifyContent: 'center', alignItems: 'center' },
  dayChipWeekend: { width: 72, justifyContent: 'center', alignItems: 'center' },
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
  gymFilterChipSmall: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 38,
    justifyContent: 'center',
    backgroundColor: '#1D2732',
    borderColor: '#5A6B7B',
  },
  gymFilterChipActive: { borderColor: '#5B9ECF' },
  chipActive: { backgroundColor: '#1B3855', borderColor: '#4D8FBF' },
  chipText: { color: '#E3EAF2', fontWeight: '600', lineHeight: 20, fontSize: 14 },
  gymFilterChipText: { color: '#F2F7FC', fontSize: 15, fontWeight: '700', lineHeight: 22 },
  gymFilterChipTextSmall: { color: '#F2F7FC', fontSize: 13, fontWeight: '700', lineHeight: 20 },
  chipTextActive: { color: '#CCE4FF' },
  libraryListScroll: { flex: 1 },
  libraryList: { gap: 6, paddingTop: 8, paddingBottom: 12 },
  libraryItem: {
    borderWidth: 1,
    borderColor: '#273644',
    borderRadius: 10,
    backgroundColor: '#1A222C',
    padding: 8,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  libraryItemMain: { flex: 1, gap: 4 },
  libraryName: { color: '#E3EAF2', fontSize: 15, fontWeight: '700' },
  libraryTagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  libraryTag: { borderRadius: 999, backgroundColor: '#2B3A48', paddingHorizontal: 8, paddingVertical: 4 },
  libraryTagText: { color: '#D3E7F8', fontSize: 12, fontWeight: '700' },
  libraryItemButton: { minWidth: 0, minHeight: 0, paddingVertical: 2, paddingHorizontal: 8 },
  wizardStepLabel: { marginTop: 2, marginBottom: 4, color: '#8FA1B3' },
  wizardBlock: { marginTop: 24, gap: 10 },
  wizardSectionTitle: { color: '#DCE4EC', fontSize: 16, fontWeight: '700' },
  wizardFieldLabel: { color: '#A8BACB', fontSize: 13, marginBottom: 10 },
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
  wizardBottomSheet: { height: '74%' },
  wizardContentArea: { flex: 1, minHeight: 180 },
  wizardActions: { marginTop: 28, paddingBottom: 8, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
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
  timePickerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  timePickerStepRow: { gap: 6, marginBottom: 8 },
  timePreviewText: { color: '#FFFFFF', textAlign: 'center', fontSize: 14, fontWeight: '600', marginTop: 4 },
  timePickerActions: { marginTop: 4, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  deleteDialogText: { color: '#DCE4EC', fontSize: 15, lineHeight: 22 },
  dropdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 10 },
  dropdownHint: { color: '#FFFFFF' },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 8 },
  dropdownText: { flex: 1, fontSize: 15, color: '#FFFFFF' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  chartCard: { marginHorizontal: 12, marginTop: 8, backgroundColor: '#151D26', borderRadius: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#24313E' },
  monthTitle: { marginTop: 10, textAlign: 'center', fontSize: 22, fontWeight: '700', color: '#DCE4EC' },
  diaryChartHeader: { marginTop: 10, marginHorizontal: 12, minHeight: 40, justifyContent: 'center', position: 'relative' },
  diaryMonthTitle: { marginTop: 0, textAlign: 'center' },
  diaryViewButtonWrap: { position: 'absolute', right: 0 },
  axisRow: { flexDirection: 'row', width: DAY_WIDTH * 68 },
  axisDay: { width: DAY_WIDTH, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  axisWeek: { fontSize: 12, color: '#8FA1B3', textAlign: 'center', width: '100%' },
  axisDate: { fontSize: 11, color: '#8FA1B3', textAlign: 'center', width: '100%' },
  axisIdag: { fontSize: 11, color: 'transparent', textAlign: 'center', width: '100%', minHeight: 14 },
  todayText: { fontWeight: '700', color: '#7FC8FF' },
  chartHelpText: { marginTop: 6, color: '#9AAEC0', fontSize: 12, textAlign: 'center' },
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
  seriesTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
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
  trainingTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  trainingHomeButtonsRow: { flexDirection: 'row', gap: 8 },
  trainingHomeButton: { flex: 1 },
  trainingHomeButtonContent: { minHeight: 52 },
  trainingHomeButtonCustom: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#2D3F53',
    paddingHorizontal: 13,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  trainingHomeButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15, textAlign: 'center' },
  trainingTransitionHost: { flex: 1, overflow: 'hidden' },
  trainingViewWrap: { flex: 1, backgroundColor: APP_BG_COLOR },
  trainingBlurOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 15,
    elevation: 15,
  },
  trainingPreviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 16,
    elevation: 16,
    backgroundColor: APP_BG_COLOR,
    borderRadius: 16,
    overflow: 'hidden',
  },
  trainingHomeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A222C',
    borderRadius: 16,
    padding: 16,
    minHeight: 72,
    gap: 14,
    overflow: 'hidden',
  },
  trainingHomeCardHalf: { flex: 1, minWidth: 0 },
  trainingHomeCardRow: { flexDirection: 'row', gap: 12 },
  trainingHomeCardStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    backgroundColor: '#1A222C',
    borderRadius: 16,
    padding: 16,
    minHeight: 72,
    gap: 10,
    overflow: 'hidden',
  },
  trainingHomeCardStackedTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  trainingHomeCardTitleWrap: { flex: 1, minWidth: 0, justifyContent: 'center' },
  trainingHomeCardStackedText: { width: '100%', gap: 2 },
  trainingHomeCardIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trainingHomeCardTextWrap: { flex: 1, justifyContent: 'center', minWidth: 0, overflow: 'hidden' },
  trainingHomeCardTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 15, flexShrink: 1 },
  trainingHomeCardSubtitle: { color: '#8FA1B3', fontSize: 12, marginTop: 2, flexShrink: 1 },
  preloadedPlaceholderCard: {
    backgroundColor: '#1A222C',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  preloadedPlaceholderTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 18 },
  preloadedPlaceholderText: { color: '#8FA1B3', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  trainingPrimaryAction: {
    borderRadius: 14,
    backgroundColor: '#40504A',
    paddingVertical: 16,
    paddingHorizontal: 14,
    gap: 6,
    alignItems: 'center',
  },
  trainingPrimaryTitle: { color: '#FFFFFF', fontWeight: '800', fontSize: 20, textAlign: 'center' },
  trainingPrimarySubtitle: { color: '#FFFFFF', fontSize: 13, textAlign: 'center' },
  trainingPbOverviewButton: {
    backgroundColor: '#55534A',
  },
  trainingPbOverviewTitle: { color: '#FFFFFF' },
  trainingPbOverviewSubtitle: { color: '#FFFFFF' },
  ongoingWorkoutButton: {
    backgroundColor: '#40504A',
  },
  ongoingWorkoutText: { color: '#FFFFFF', fontWeight: '700', textAlign: 'center', fontSize: 14 },
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
  historyCardTitle: { color: '#FFFFFF', fontSize: 19, fontWeight: '800' },
  historyCardDateTime: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  historyCardDuration: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  historyDetailMeta: { color: '#FFFFFF', fontSize: 12, marginTop: 4, textAlign: 'center' },
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
  historySetValue: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  trainingSessionTop: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, minHeight: 46, justifyContent: 'center' },
  trainingSessionTopRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  trainingTopActionsRight: { minWidth: 86, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6 },
  trainingMiniButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3F5263',
    backgroundColor: '#1A222C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trainingMiniPrimaryButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#7FBF82',
    backgroundColor: '#A5D6A7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trainingMiniDangerButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4B2E34',
    backgroundColor: '#23181B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionAbortTopButton: {
    position: 'absolute',
    right: 12,
    top: 8,
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4B2E34',
    backgroundColor: '#23181B',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
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
  trainingStatButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', marginTop: -1 },
  trainingMeta: { color: '#A8BACB', fontSize: 13, marginTop: 2 },
  loggedSetList: { gap: 6, marginTop: 2 },
  loggedSetEmpty: { color: '#FFFFFF', fontSize: 13 },
  loggedSetRow: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2C3A49',
    backgroundColor: '#16202B',
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 8,
  },
  loggedSetRowMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  loggedSetTitle: { color: '#FFFFFF', fontWeight: '700', minWidth: 48 },
  loggedSetMetrics: { alignItems: 'center', minWidth: 108 },
  loggedSetMetricLabel: { color: '#FFFFFF', fontSize: 11, textTransform: 'uppercase' },
  loggedSetMetricValue: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  pbFeedbackBox: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3D8055',
    backgroundColor: '#1B3A2A',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  pbFeedbackTitle: { color: '#D7F7E2', fontWeight: '800', fontSize: 13 },
  trainingBottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  trainingLastLogged: { color: '#8FA1B3', fontSize: 12 },
  trainingButtons: { flexDirection: 'row', gap: 8, marginTop: 12 },
  savedPlanHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  savedPlanActionsRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  savedPlanActionButton: { flex: 1 },
  savedPlanStartButton: { marginTop: 12 },
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
  categorySectionLabel: { color: '#9AAEC0', fontSize: 13, fontWeight: '600', marginTop: 14, marginBottom: 6 },
  categoryChipSection: { marginBottom: 4 },
  pbModalCard: { width: '100%', maxWidth: 520, maxHeight: '84%', alignSelf: 'center' },
  pbModalHeader: { gap: 10, marginBottom: 8 },
  pbList: { maxHeight: 360 },
  pbRow: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2C3A49',
    backgroundColor: '#16202B',
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
  },
  pbRowText: { color: '#DCE4EC', fontWeight: '700', fontSize: 13 },
  pbRowDate: { color: '#9DB0C2', fontWeight: '600', fontSize: 12 },
  pbSummaryCard: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '84%',
    alignSelf: 'center',
    paddingTop: 12,
    backgroundColor: '#151D26',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#24313E',
  },
  pbSummaryHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  pbSummaryTitle: { color: '#E3EAF2', fontSize: 20, fontWeight: '800' },
  pbSummaryMeta: { color: '#A8BACB', fontSize: 12, fontWeight: '700', marginTop: 2 },
  pbSummaryCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#33414F',
    backgroundColor: '#1A222C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pbSummaryList: { maxHeight: 420 },
  pbSummaryRow: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2C3A49',
    backgroundColor: '#16202B',
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 6,
  },
  pbSummaryExercise: { color: '#DCE4EC', fontWeight: '700', fontSize: 14 },
  pbSummaryMainValue: { color: '#A8BACB', fontWeight: '700', fontSize: 13, marginTop: 2 },
  pbSummarySubValue: { color: '#8FA1B3', fontWeight: '600', fontSize: 12, marginTop: 3 },
  pbSummaryMoreText: { color: '#8FA1B3', fontSize: 12, textAlign: 'center', marginTop: 6 },
  builderConfirmCard: { width: '100%', maxWidth: 520, alignSelf: 'center' },
  builderConfirmSummary: { marginTop: 8, marginBottom: 16, paddingVertical: 10, paddingHorizontal: 8, backgroundColor: '#1A222C', borderRadius: 10, borderWidth: 1, borderColor: '#2B3A48' },
  builderConfirmPlanName: { color: '#E3EAF2', fontSize: 16, fontWeight: '700', marginBottom: 10 },
  builderConfirmExerciseRow: { color: '#A8BACB', fontSize: 14, marginTop: 4, lineHeight: 20 },
});
