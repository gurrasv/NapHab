import 'react-native-gesture-handler';
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { DarkTheme as NavigationDarkTheme, NavigationContainer, useFocusEffect } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import MapLibreGL from '@maplibre/maplibre-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Gesture, GestureDetector, GestureHandlerRootView, ScrollView, Swipeable } from 'react-native-gesture-handler';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import {
  consumeAndroidPendingCompletions,
  consumeIosPendingCompletionsNative,
  dismissAndroidWorkoutNotification,
  dismissIosWorkoutLiveActivity,
  ensureAndroidExactAlarmPermission,
  requestAndroidNotificationPermission,
  scheduleAndroidNotifications,
  showAndroidWorkoutNotification,
  showIosWorkoutLiveActivity,
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
  Image,
  ImageSourcePropType,
  LayoutAnimation,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Platform,
  Pressable,
  ScrollView as RNScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  Keyboard,
  UIManager,
  useWindowDimensions,
  View,
} from 'react-native';
import { Button, Checkbox, Dialog, MD3DarkTheme, Portal, Provider as PaperProvider } from 'react-native-paper';
import { Modalize } from 'react-native-modalize';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { OPEN_FREE_MAP_STYLE_URL } from './modules/run-tracker/mapConfig';
import { getRouteBounds, toLineStringFeature } from './modules/run-tracker/mapRoute';
import { useActiveRunSession } from './modules/run-tracker/useActiveRunSession';
import { RunPoint, RunRecord, RunSport } from './modules/run-tracker/types';

SplashScreen.preventAutoHideAsync().catch(() => {});

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
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
type PendingCompletionItem = { exerciseId: string; atIso: string };
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
  archivedPainSeries?: PainSeries[];
  workoutPlans?: WorkoutPlan[];
  completedWorkouts?: CompletedWorkout[];
  exerciseWeightPbs?: ExerciseWeightPb[];
  rehabLibraryExercises?: LibraryExercise[];
  gymLibraryExercises?: LibraryExercise[];
  gymCustomMuscleGroups?: string[];
  rehabCustomMuscleGroups?: string[];
  analysisBlocks?: AnalysisBlock[];
};
type DiaryViewMode = 'tim' | 'dag' | 'manad';
type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
type LibraryExercise = { id: string; name: string; tags: string[]; primaryMuscle?: string; primarySubMuscles?: string[]; secondaryMuscles?: string[]; secondarySubMuscles?: Record<string, string[]> };
type WizardMode = 'create' | 'edit';

const EXERCISE_IMAGE_SOURCES: Partial<Record<string, ImageSourcePropType>> = {
  'bench-press': require('./assets/exercise-images/bench-press-transparent.png'),
  'cable-fly': require('./assets/exercise-images/cable-fly-transparent.png'),
  'chest-press-machine': require('./assets/exercise-images/chest-press-machine-transparent.png'),
  'close-grip-bench': require('./assets/exercise-images/close-grip-bench-transparent.png'),
  'dips': require('./assets/exercise-images/dips-transparent.png'),
  'dumbbell-flyes': require('./assets/exercise-images/dumbbell-flyes-transparent.png'),
  'dumbbell-press': require('./assets/exercise-images/dumbbell-press-transparent.png'),
  'incline-dumbbell-press': require('./assets/exercise-images/incline-dumbbell-press-transparent.png'),
  snoanglar: require('./assets/exercise-images/snoanglar-transparent.png'),
  'pec-deck': require('./assets/exercise-images/pec-deck-transparent.png'),
  'push-up': require('./assets/exercise-images/push-up-transparent.png'),
  lunges: require('./assets/exercise-images/utfallsteg-transparent.png'),
  'smith-machine-press': require('./assets/exercise-images/smith-machine-press-transparent.png'),
  'tricep-dip-machine': require('./assets/exercise-images/tricep-dip-machine-transparent.png'),
  utfallsteg: require('./assets/exercise-images/utfallsteg-transparent.png'),
};

const Tab = createBottomTabNavigator();

type TabTransitionDirection = 'left' | 'right' | null;
const TabTransitionContext = createContext<{
  direction: TabTransitionDirection;
  clearDirection: () => void;
}>({ direction: null, clearDirection: () => {} });

const TAB_SWIPE_DURATION_MS = 180;
const TAB_SWIPE_DISTANCE_RATIO = 0.05;
const APP_BG_COLOR = '#0F1419';
const NATIVE_SPLASH_IMAGE_WIDTH = 230;
  
const TITLE_FADE_SCROLL_DISTANCE = 70;
const LIBRARY_MODAL_CLOSE_THRESHOLD = 170;
const LIBRARY_MODAL_CLOSE_VELOCITY = 1600;
const LIBRARY_MODAL_DRAG_TOSS = 0.14;
const LIBRARY_MODAL_CLOSE_ANIMATION_CONFIG = {
  timing: {
    duration: 550,
    easing: Easing.out(Easing.cubic),
  },
} as const;

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

function PtrLogo({ width = 340 }: { width?: number }) {
  const size = Math.round(width);
  return (
    <Image
      source={require('./assets/splash-icon.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
      fadeDuration={0}
    />
  );
}

function IntroSplashOverlay({ onDone, onHandoffFrameReady }: { onDone: () => void; onHandoffFrameReady: () => void }) {
  const [phase, setPhase] = useState<'static' | 'animating'>('static');
  const handoffReportedRef = useRef(false);
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const tintOpacity = useRef(new Animated.Value(0)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(1)).current;
  const ripple1Opacity = useRef(new Animated.Value(0)).current;
  const ripple1Scale = useRef(new Animated.Value(0.8)).current;
  const ripple2Opacity = useRef(new Animated.Value(0)).current;
  const ripple2Scale = useRef(new Animated.Value(0.84)).current;
  const ripple3Opacity = useRef(new Animated.Value(0)).current;
  const ripple3Scale = useRef(new Animated.Value(0.88)).current;
  const logoWidth = NATIVE_SPLASH_IMAGE_WIDTH;

  useEffect(() => {
    let rafA = 0;
    let rafB = 0;
    rafA = requestAnimationFrame(() => {
      rafB = requestAnimationFrame(() => {
        setPhase('animating');
      });
    });
    return () => {
      cancelAnimationFrame(rafA);
      cancelAnimationFrame(rafB);
    };
  }, []);

  useEffect(() => {
    if (phase !== 'animating') return;
    const sequence = Animated.sequence([
      Animated.parallel([
        Animated.timing(logoScale, {
          toValue: 1.04,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.sequence([
          Animated.timing(ripple1Opacity, {
            toValue: 0.34,
            duration: 120,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(ripple1Opacity, {
            toValue: 0,
            duration: 760,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(ripple1Scale, {
          toValue: 2.2,
          duration: 880,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(140),
          Animated.timing(ripple2Opacity, {
            toValue: 0.28,
            duration: 100,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(ripple2Opacity, {
            toValue: 0,
            duration: 700,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.delay(140),
          Animated.timing(ripple2Scale, {
            toValue: 2.35,
            duration: 820,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.delay(280),
          Animated.timing(ripple3Opacity, {
            toValue: 0.22,
            duration: 100,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(ripple3Opacity, {
            toValue: 0,
            duration: 620,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.delay(280),
          Animated.timing(ripple3Scale, {
            toValue: 2.5,
            duration: 760,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(logoScale, {
          toValue: 1.12,
          duration: 760,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(logoScale, {
          toValue: 3.2,
          duration: 460,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(logoOpacity, {
          toValue: 0.96,
          duration: 460,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 260,
          delay: 210,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]);

    sequence.start(({ finished }) => {
      if (finished) onDone();
    });

    return () => {
      sequence.stop();
    };
  }, [logoOpacity, logoScale, onDone, overlayOpacity, phase, ripple1Opacity, ripple1Scale, ripple2Opacity, ripple2Scale, ripple3Opacity, ripple3Scale]);

  const handleOverlayLayout = useCallback(() => {
    if (handoffReportedRef.current) return;
    handoffReportedRef.current = true;
    onHandoffFrameReady();
  }, [onHandoffFrameReady]);

  return (
    <Animated.View pointerEvents="auto" onLayout={handleOverlayLayout} style={[styles.introOverlay, { opacity: overlayOpacity }]}>
      <View style={styles.introInner}>
        <View pointerEvents="none" style={styles.introBackdropBase} />
        <Animated.View pointerEvents="none" style={[styles.introBackdropTint, { opacity: tintOpacity }]} />
        <Animated.View
          pointerEvents="none"
          style={[styles.introRippleRing, { opacity: ripple1Opacity, transform: [{ scale: ripple1Scale }] }]}
        />
        <Animated.View
          pointerEvents="none"
          style={[styles.introRippleRing, styles.introRippleRingSoft, { opacity: ripple2Opacity, transform: [{ scale: ripple2Scale }] }]}
        />
        <Animated.View
          pointerEvents="none"
          style={[styles.introRippleRing, styles.introRippleRingFaint, { opacity: ripple3Opacity, transform: [{ scale: ripple3Scale }] }]}
        />
        <Animated.View
          style={{
            opacity: logoOpacity,
            transform: [{ scale: logoScale }],
          }}
        >
          <PtrLogo width={logoWidth} />
        </Animated.View>
      </View>
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
const WEIGHT_KEY_FACTOR = 100; // 0.01 kg increments
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
const formatWeightKg = (weightKg: number): string => {
  if (Number.isInteger(weightKg)) return `${weightKg}`;
  const s = weightKg.toFixed(2);
  return s.replace(/0+$/, '').replace(/\.$/, '');
};
const clampNumber = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const sanitizeNumericInput = (text: string, allowDecimal: boolean): string => {
  const normalized = text.replace(',', '.');
  const filtered = allowDecimal ? normalized.replace(/[^0-9.]/g, '') : normalized.replace(/[^0-9]/g, '');
  if (!allowDecimal) return filtered;
  const [head, ...tail] = filtered.split('.');
  if (tail.length === 0) return head;
  const decimals = tail.join('').slice(0, 2);
  return `${head}.${decimals}`;
};
const formatNumericInputValue = (value: number, allowDecimal: boolean): string => {
  if (value <= 0) return '';
  return allowDecimal ? formatWeightKg(value) : `${Math.round(value)}`;
};

function NumericStepperInput({
  value,
  onChangeValue,
  min,
  max,
  allowDecimal = false,
  accessibilityLabel,
}: {
  value: number;
  onChangeValue: (value: number) => void;
  min: number;
  max: number;
  allowDecimal?: boolean;
  accessibilityLabel: string;
}) {
  const [draft, setDraft] = useState(formatNumericInputValue(value, allowDecimal));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) setDraft(formatNumericInputValue(value, allowDecimal));
  }, [allowDecimal, isFocused, value]);

  const normalizeValue = useCallback((nextValue: number) => {
    const stepped = allowDecimal ? Math.round(nextValue * WEIGHT_KEY_FACTOR) / WEIGHT_KEY_FACTOR : Math.round(nextValue);
    return clampNumber(stepped, min, max);
  }, [allowDecimal, max, min]);

  const commitDraft = useCallback((nextDraft: string) => {
    const sanitized = sanitizeNumericInput(nextDraft, allowDecimal);
    if (!sanitized || sanitized === '.') {
      onChangeValue(0);
      setDraft('');
      return;
    }
    const parsed = Number(sanitized);
    if (!Number.isFinite(parsed)) {
      setDraft(formatNumericInputValue(value, allowDecimal));
      return;
    }
    const normalized = normalizeValue(parsed);
    onChangeValue(normalized);
    setDraft(formatNumericInputValue(normalized, allowDecimal));
  }, [allowDecimal, normalizeValue, onChangeValue, value]);

  const inputRef = useRef<TextInput>(null);
  const [forceCaretEnd, setForceCaretEnd] = useState(false);

  useEffect(() => {
    if (!isFocused) return;
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      inputRef.current?.blur();
    });
    return () => sub.remove();
  }, [isFocused]);

  useEffect(() => {
    if (forceCaretEnd) {
      const timer = setTimeout(() => setForceCaretEnd(false), 50);
      return () => clearTimeout(timer);
    }
  }, [forceCaretEnd]);

  const handleChangeText = useCallback((text: string) => {
    const sanitized = sanitizeNumericInput(text, allowDecimal);
    setDraft(sanitized);
    if (!sanitized || sanitized === '.' || sanitized.endsWith('.')) return;
    const parsed = Number(sanitized);
    if (!Number.isFinite(parsed)) return;
    const normalized = normalizeValue(parsed);
    onChangeValue(normalized);
  }, [allowDecimal, normalizeValue, onChangeValue]);

  const selectionProp = forceCaretEnd ? { start: draft.length, end: draft.length } : undefined;

  return (
    <View style={styles.trainingStatActions}>
      <TextInput
        ref={inputRef}
        value={draft}
        onChangeText={handleChangeText}
        onFocus={() => {
          setIsFocused(true);
          setForceCaretEnd(true);
        }}
        onBlur={() => {
          setIsFocused(false);
          setForceCaretEnd(false);
          commitDraft(draft);
        }}
        onSubmitEditing={() => commitDraft(draft)}
        keyboardType={allowDecimal ? 'decimal-pad' : 'number-pad'}
        selection={selectionProp}
        style={[styles.trainingStatInput, isFocused && styles.trainingStatInputFocused]}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}
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
const IOS_REMINDER_CATEGORY_ID = 'trackwell.exercise.reminder';
const IOS_ACTION_MARK_DONE = 'trackwell.action.done';
const IOS_ACTION_SNOOZE = 'trackwell.action.snooze';
const IOS_SNOOZE_MINUTES = 10;
const IOS_PENDING_COMPLETIONS_STORAGE_KEY = 'naphab_ios_pending_completions_v1';

function isEveryDayLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return normalized === 'varje dag' || normalized === 'alla dagar';
}

/** Parse the human-readable daysLabel back to JS day-of-week numbers (0 = Sun). */
function parseDaysLabelToJsDays(daysLabel: string): number[] {
  if (isEveryDayLabel(daysLabel)) return [0, 1, 2, 3, 4, 5, 6];
  return daysLabel
    .split(',')
    .map((label) => label.trim().toLowerCase())
    .map((label) => WEEKDAY_KEY_BY_LABEL[label])
    .filter((key): key is WeekdayKey => !!key)
    .map((key) => WEEKDAY_KEY_TO_JS_DAY[key]);
}

function parseReminderTime(rawTime: string): { hours: number; minutes: number; canonicalTime: string } | null {
  const normalized = rawTime.trim().replace('.', ':');
  const [hoursRaw, minutesRaw] = normalized.split(':');
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

function mapJsDayToIosWeekday(jsDay: number): number {
  // JS: Sun=0..Sat=6, iOS weekly trigger: Sun=1..Sat=7.
  return jsDay === 0 ? 1 : jsDay + 1;
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

async function requestIosNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'ios') return true;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const next = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });
  return next.granted;
}

async function ensureIosNotificationCategoryConfigured(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const actions: Notifications.NotificationAction[] = [
    {
      identifier: IOS_ACTION_MARK_DONE,
      buttonTitle: 'Klar',
      options: {
          opensAppToForeground: false,
          isAuthenticationRequired: false,
      },
    },
    {
      identifier: IOS_ACTION_SNOOZE,
      buttonTitle: `Snooza ${IOS_SNOOZE_MINUTES} min`,
      options: {
          opensAppToForeground: false,
          isAuthenticationRequired: false,
      },
    },
  ];

  await Notifications.setNotificationCategoryAsync(IOS_REMINDER_CATEGORY_ID, actions);
  // iOS can occasionally fail to persist a category during initial startup race;
  // verify once and retry so scheduled notifications consistently get actions.
  const categories = await Notifications.getNotificationCategoriesAsync();
  const hasReminderCategory = categories.some((category) => category.identifier === IOS_REMINDER_CATEGORY_ID);
  if (!hasReminderCategory) {
    await Notifications.setNotificationCategoryAsync(IOS_REMINDER_CATEGORY_ID, actions);
  }
}

async function appendIosPendingCompletion(completion: PendingCompletionItem): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    const raw = await AsyncStorage.getItem(IOS_PENDING_COMPLETIONS_STORAGE_KEY);
    const current = raw ? JSON.parse(raw) as PendingCompletionItem[] : [];
    const list = Array.isArray(current) ? current : [];
    const key = `${completion.exerciseId}|${completion.atIso}`;
    if (list.some((row) => `${row.exerciseId}|${row.atIso}` === key)) return;
    await AsyncStorage.setItem(
      IOS_PENDING_COMPLETIONS_STORAGE_KEY,
      JSON.stringify([...list, completion]),
    );
  } catch {
    // Ignore persistence failures for pending actions.
  }
}

async function consumeIosPendingCompletions(): Promise<PendingCompletionItem[]> {
  if (Platform.OS !== 'ios') return [];
  try {
    const native = await consumeIosPendingCompletionsNative();
    if (Array.isArray(native) && native.length > 0) {
      return native
        .filter((row) => row?.exerciseId && row?.atIso)
        .map((row) => ({ exerciseId: row.exerciseId, atIso: row.atIso }));
    }
  } catch {
    // Fall back to AsyncStorage backlog for compatibility if native module is unavailable.
  }
  try {
    const raw = await AsyncStorage.getItem(IOS_PENDING_COMPLETIONS_STORAGE_KEY);
    await AsyncStorage.removeItem(IOS_PENDING_COMPLETIONS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as PendingCompletionItem[] : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function extractNotificationDataValue(
  data: Record<string, unknown> | undefined,
  key: string,
): string {
  const value = data?.[key];
  return typeof value === 'string' ? value : '';
}

function extractNotificationDataNumber(
  data: Record<string, unknown> | undefined,
  key: string,
  fallback = 0,
): number {
  const value = data?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return fallback;
}

async function handleIosNotificationResponse(
  response: Notifications.NotificationResponse,
): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const action = response.actionIdentifier;
  if (action !== IOS_ACTION_MARK_DONE && action !== IOS_ACTION_SNOOZE) {
    return;
  }

  const content = response.notification.request.content;
  const data = (content.data ?? {}) as Record<string, unknown>;
  const exerciseId = extractNotificationDataValue(data, 'exerciseId');
  if (!exerciseId) return;

  if (action === IOS_ACTION_MARK_DONE) {
    await appendIosPendingCompletion({
      exerciseId,
      atIso: new Date().toISOString(),
    });
    return;
  }

  if (action === IOS_ACTION_SNOOZE) {
    await ensureIosNotificationCategoryConfigured();
    const title = content.title || 'Övning';
    const sets = extractNotificationDataNumber(data, 'sets', 0);
    const reps = extractNotificationDataNumber(data, 'reps', 0);
    const scheduleId = extractNotificationDataValue(data, 'scheduleId');
    const triggerAt = new Date(Date.now() + IOS_SNOOZE_MINUTES * 60 * 1000);
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body: `${sets} x ${reps}`,
        sound: true,
        categoryIdentifier: IOS_REMINDER_CATEGORY_ID,
        data: {
          exerciseId,
          scheduleId: scheduleId ? `${scheduleId}-snooze-${triggerAt.getTime()}` : `snooze-${exerciseId}-${triggerAt.getTime()}`,
          scheduledAtIso: triggerAt.toISOString(),
          sets,
          reps,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerAt,
      },
    });
  }
}

async function scheduleExerciseNotifications(
  exercises: Exercise[],
): Promise<void> {
  if (!Device.isDevice) return;
  if (Platform.OS === 'android') {
    const now = new Date();
    const candidates = buildUpcomingScheduleOccurrences(exercises, {
      now,
      windowDays: 30,
    });
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
    return;
  }
  if (Platform.OS !== 'ios') return;

  const granted = await requestIosNotificationPermission();
  if (!granted) return;
  await ensureIosNotificationCategoryConfigured();

  await Notifications.cancelAllScheduledNotificationsAsync();
  for (const exercise of exercises) {
    if (!exercise.remindersOn || exercise.times.length === 0) continue;
    const jsDays = parseDaysLabelToJsDays(exercise.daysLabel);
    if (jsDays.length === 0) continue;

    for (const rawTime of exercise.times) {
      const parsedTime = parseReminderTime(rawTime);
      if (!parsedTime) continue;
      const body = `${exercise.sets} x ${exercise.reps}`;
      const baseData = {
        exerciseId: exercise.id,
        sets: exercise.sets,
        reps: exercise.reps,
      };

      if (jsDays.length === 7) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: exercise.title,
            body,
            sound: true,
            categoryIdentifier: IOS_REMINDER_CATEGORY_ID,
            data: {
              ...baseData,
              scheduleId: `${exercise.id}-${parsedTime.canonicalTime}-daily`,
              scheduledAtIso: new Date().toISOString(),
            },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DAILY,
            hour: parsedTime.hours,
            minute: parsedTime.minutes,
          },
        });
        continue;
      }

      for (const jsDay of jsDays) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: exercise.title,
            body,
            sound: true,
            categoryIdentifier: IOS_REMINDER_CATEGORY_ID,
            data: {
              ...baseData,
              scheduleId: `${exercise.id}-${parsedTime.canonicalTime}-${jsDay}-weekly`,
              scheduledAtIso: new Date().toISOString(),
            },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
            weekday: mapJsDayToIosWeekday(jsDay),
            hour: parsedTime.hours,
            minute: parsedTime.minutes,
          },
        });
      }
    }
  }
}

const LIBRARY_EXERCISES: LibraryExercise[] = [
  { id: 'jefferson-curls', name: 'Jefferson curls', tags: ['Rygg', 'Baksida lår'], primaryMuscle: 'Rygg', secondaryMuscles: ['Baksida lår'] },
  { id: 'snoanglar', name: 'Snöänglar', tags: ['Axlar', 'Bröstrygg'], primaryMuscle: 'Axlar', secondaryMuscles: ['Bröstrygg'] },
  { id: 'nervmobilisering-ischias', name: 'Nervmobilisering ischias', tags: ['Nerver', 'Ben'], primaryMuscle: 'Nerver', secondaryMuscles: ['Ben'] },
  { id: 'nervmobilisering-brachialis', name: 'Nervmobilisering brachialis', tags: ['Nerver', 'Armar'], primaryMuscle: 'Nerver', secondaryMuscles: ['Armar'] },
  { id: 'utfallsteg', name: 'Utfallsteg', tags: ['Ben'], primaryMuscle: 'Ben', secondaryMuscles: [] },
  { id: 'enbensknaboj', name: 'Enbensknäböj', tags: ['Ben', 'Balans'], primaryMuscle: 'Ben', secondaryMuscles: ['Balans'] },
  { id: 'static-neckhold', name: 'Static neckhold', tags: ['Nacke'], primaryMuscle: 'Nacke', secondaryMuscles: [] },
  { id: 'sittande-knaspark', name: 'Sittande knäspark', tags: ['Ben'], primaryMuscle: 'Ben', secondaryMuscles: [] },
  { id: 'rotation-nacke', name: 'Rotation nacke', tags: ['Nacke'], primaryMuscle: 'Nacke', secondaryMuscles: [] },
  { id: 'boj-nacke', name: 'Böj nacke', tags: ['Nacke'], primaryMuscle: 'Nacke', secondaryMuscles: [] },
  { id: 'boj-strack-brostrygg', name: 'Sittande böj/sträck bröstrygg', tags: ['Bröstrygg'], primaryMuscle: 'Bröstrygg', secondaryMuscles: [] },
];
const GYM_LIBRARY_EXERCISES: LibraryExercise[] = [
  { id: 'bench-press', name: 'Bänkpress', tags: ['Bröst', 'Triceps', 'Fria vikter'], primaryMuscle: 'Bröst', primarySubMuscles: ['Mellersta bröst'], secondaryMuscles: ['Triceps'] },
  { id: 'incline-dumbbell-press', name: 'Lutande hantelpress', tags: ['Bröst', 'Axlar', 'Fria vikter'], primaryMuscle: 'Bröst', primarySubMuscles: ['Övre bröst'], secondaryMuscles: ['Axlar'] },
  { id: 'dumbbell-press', name: 'Hantelpress', tags: ['Bröst', 'Triceps', 'Fria vikter'], primaryMuscle: 'Bröst', primarySubMuscles: ['Mellersta bröst'], secondaryMuscles: ['Triceps'] },
  { id: 'dumbbell-flyes', name: 'Hantelflyes', tags: ['Bröst', 'Fria vikter'], primaryMuscle: 'Bröst', secondaryMuscles: [] },
  { id: 'overhead-press', name: 'Militärpress', tags: ['Axlar', 'Triceps', 'Fria vikter'], primaryMuscle: 'Axlar', primarySubMuscles: ['Främre deltoid'], secondaryMuscles: ['Triceps'] },
  { id: 'dumbbell-shoulder-press', name: 'Hantelpress axlar', tags: ['Axlar', 'Triceps', 'Fria vikter'], primaryMuscle: 'Axlar', primarySubMuscles: ['Främre deltoid'], secondaryMuscles: ['Triceps'] },
  { id: 'lateral-raise', name: 'Sidolyft', tags: ['Axlar', 'Fria vikter'], primaryMuscle: 'Axlar', primarySubMuscles: ['Sidodeltoid'], secondaryMuscles: [] },
  { id: 'front-raise', name: 'Framlyft', tags: ['Axlar', 'Fria vikter'], primaryMuscle: 'Axlar', primarySubMuscles: ['Främre deltoid'], secondaryMuscles: [] },
  { id: 'face-pull', name: 'Face pull', tags: ['Axlar', 'Rygg', 'Fria vikter'], primaryMuscle: 'Axlar', primarySubMuscles: ['Bakre deltoid'], secondaryMuscles: ['Rygg'] },
  { id: 'barbell-row', name: 'Skivstångsrodd', tags: ['Rygg', 'Biceps', 'Fria vikter'], primaryMuscle: 'Rygg', primarySubMuscles: ['Latissimus dorsi'], secondaryMuscles: ['Biceps'] },
  { id: 'deadlift', name: 'Marklyft', tags: ['Rygg', 'Ben', 'Fria vikter'], primaryMuscle: 'Rygg', primarySubMuscles: ['Ländrygg'], secondaryMuscles: ['Ben'] },
  { id: 'romanian-deadlift', name: 'Raka marklyft', tags: ['Ben', 'Rygg', 'Fria vikter'], primaryMuscle: 'Ben', primarySubMuscles: ['Baksida lår'], secondaryMuscles: ['Rygg'] },
  { id: 'dumbbell-row', name: 'Hantelrodd', tags: ['Rygg', 'Biceps', 'Fria vikter'], primaryMuscle: 'Rygg', primarySubMuscles: ['Latissimus dorsi'], secondaryMuscles: ['Biceps'] },
  { id: 't-bar-row', name: 'T-bar rodd', tags: ['Rygg', 'Biceps', 'Fria vikter'], primaryMuscle: 'Rygg', primarySubMuscles: ['Latissimus dorsi'], secondaryMuscles: ['Biceps'] },
  { id: 'pull-up', name: 'Chins / Pull-up', tags: ['Rygg', 'Biceps', 'Fria vikter', 'Kroppsvikt'], primaryMuscle: 'Rygg', primarySubMuscles: ['Latissimus dorsi'], secondaryMuscles: ['Biceps'] },
  { id: 'squat', name: 'Knäböj', tags: ['Ben', 'Fria vikter'], primaryMuscle: 'Ben', primarySubMuscles: ['Framsida lår'], secondaryMuscles: [] },
  { id: 'goblet-squat', name: 'Goblet squat', tags: ['Ben', 'Fria vikter'], primaryMuscle: 'Ben', primarySubMuscles: ['Framsida lår'], secondaryMuscles: [] },
  { id: 'bulgarian-split-squat', name: 'Bulgariansk split squat', tags: ['Ben', 'Fria vikter'], primaryMuscle: 'Ben', primarySubMuscles: ['Framsida lår'], secondaryMuscles: [] },
  { id: 'lunges', name: 'Utfall', tags: ['Ben', 'Fria vikter', 'Kroppsvikt'], primaryMuscle: 'Ben', primarySubMuscles: ['Framsida lår'], secondaryMuscles: [] },
  { id: 'hip-thrust', name: 'Hip thrust', tags: ['Säte', 'Ben', 'Fria vikter'], primaryMuscle: 'Säte', secondaryMuscles: ['Ben'] },
  { id: 'calf-raise', name: 'Vadlyft', tags: ['Vader', 'Fria vikter'], primaryMuscle: 'Vader', secondaryMuscles: [] },
  { id: 'bicep-curl', name: 'Bicepscurl', tags: ['Biceps', 'Fria vikter'], primaryMuscle: 'Biceps', secondaryMuscles: [] },
  { id: 'hammer-curl', name: 'Hammer curl', tags: ['Biceps', 'Underarm', 'Fria vikter'], primaryMuscle: 'Biceps', secondaryMuscles: ['Underarm'] },
  { id: 'barbell-curl', name: 'Skivstångscurl', tags: ['Biceps', 'Fria vikter'], primaryMuscle: 'Biceps', secondaryMuscles: [] },
  { id: 'tricep-kickback', name: 'Triceps kickback', tags: ['Triceps', 'Fria vikter'], primaryMuscle: 'Triceps', secondaryMuscles: [] },
  { id: 'skull-crusher', name: 'Fransk press', tags: ['Triceps', 'Fria vikter'], primaryMuscle: 'Triceps', secondaryMuscles: [] },
  { id: 'close-grip-bench', name: 'Smal bänkpress', tags: ['Triceps', 'Bröst', 'Fria vikter'], primaryMuscle: 'Triceps', secondaryMuscles: ['Bröst'] },
  { id: 'lat-pulldown', name: 'Latsdrag', tags: ['Rygg', 'Biceps', 'Maskin'], primaryMuscle: 'Rygg', primarySubMuscles: ['Latissimus dorsi'], secondaryMuscles: ['Biceps'] },
  { id: 'chest-press-machine', name: 'Bröstpress (maskin)', tags: ['Bröst', 'Triceps', 'Maskin'], primaryMuscle: 'Bröst', primarySubMuscles: ['Mellersta bröst'], secondaryMuscles: ['Triceps'] },
  { id: 'pec-deck', name: 'Pec deck / Butterfly', tags: ['Bröst', 'Maskin'], primaryMuscle: 'Bröst', secondaryMuscles: [] },
  { id: 'cable-fly', name: 'Kabel flyes', tags: ['Bröst', 'Kabel'], primaryMuscle: 'Bröst', secondaryMuscles: [] },
  { id: 'smith-machine-press', name: 'Smith maskin press', tags: ['Axlar', 'Bröst', 'Maskin'], primaryMuscle: 'Axlar', primarySubMuscles: ['Främre deltoid'], secondaryMuscles: ['Bröst'] },
  { id: 'cable-lateral-raise', name: 'Kabel sidolyft', tags: ['Axlar', 'Kabel'], primaryMuscle: 'Axlar', primarySubMuscles: ['Sidodeltoid'], secondaryMuscles: [] },
  { id: 'cable-row', name: 'Kabelrodd', tags: ['Rygg', 'Biceps', 'Kabel'], primaryMuscle: 'Rygg', primarySubMuscles: ['Latissimus dorsi'], secondaryMuscles: ['Biceps'] },
  { id: 'seated-cable-row', name: 'Sittande kabelrodd', tags: ['Rygg', 'Biceps', 'Kabel'], primaryMuscle: 'Rygg', primarySubMuscles: ['Latissimus dorsi'], secondaryMuscles: ['Biceps'] },
  { id: 'straight-arm-pulldown', name: 'Raka armar latsdrag', tags: ['Rygg', 'Kabel'], primaryMuscle: 'Rygg', primarySubMuscles: ['Latissimus dorsi'], secondaryMuscles: [] },
  { id: 'leg-press', name: 'Benpress', tags: ['Ben', 'Maskin'], primaryMuscle: 'Ben', primarySubMuscles: ['Framsida lår'], secondaryMuscles: [] },
  { id: 'leg-extension', name: 'Bensträckning', tags: ['Ben', 'Maskin'], primaryMuscle: 'Ben', primarySubMuscles: ['Framsida lår'], secondaryMuscles: [] },
  { id: 'leg-curl', name: 'Benböj', tags: ['Ben', 'Maskin'], primaryMuscle: 'Ben', primarySubMuscles: ['Baksida lår'], secondaryMuscles: [] },
  { id: 'leg-curl-standing', name: 'Stående benböj', tags: ['Ben', 'Maskin'], primaryMuscle: 'Ben', primarySubMuscles: ['Baksida lår'], secondaryMuscles: [] },
  { id: 'calf-raise-machine', name: 'Vadlyft (maskin)', tags: ['Vader', 'Maskin'], primaryMuscle: 'Vader', secondaryMuscles: [] },
  { id: 'hack-squat', name: 'Hack squat', tags: ['Ben', 'Maskin'], primaryMuscle: 'Ben', primarySubMuscles: ['Framsida lår'], secondaryMuscles: [] },
  { id: 'smith-squat', name: 'Smith maskin knäböj', tags: ['Ben', 'Maskin'], primaryMuscle: 'Ben', primarySubMuscles: ['Framsida lår'], secondaryMuscles: [] },
  { id: 'tricep-pushdown', name: 'Triceps pushdown', tags: ['Triceps', 'Kabel'], primaryMuscle: 'Triceps', secondaryMuscles: [] },
  { id: 'cable-curl', name: 'Kabelcurl', tags: ['Biceps', 'Kabel'], primaryMuscle: 'Biceps', secondaryMuscles: [] },
  { id: 'preacher-curl', name: 'Preacher curl', tags: ['Biceps', 'Maskin'], primaryMuscle: 'Biceps', secondaryMuscles: [] },
  { id: 'tricep-dip-machine', name: 'Triceps dip (maskin)', tags: ['Triceps', 'Bröst', 'Maskin'], primaryMuscle: 'Triceps', secondaryMuscles: ['Bröst'] },
  { id: 'push-up', name: 'Armhävningar', tags: ['Bröst', 'Triceps', 'Kroppsvikt'], primaryMuscle: 'Bröst', secondaryMuscles: ['Triceps'] },
  { id: 'dips', name: 'Dips', tags: ['Bröst', 'Triceps', 'Kroppsvikt'], primaryMuscle: 'Bröst', primarySubMuscles: ['Nedre bröst'], secondaryMuscles: ['Triceps'] },
  { id: 'plank', name: 'Planka', tags: ['Mage', 'Kroppsvikt'], primaryMuscle: 'Mage', secondaryMuscles: [] },
  { id: 'squat-bodyweight', name: 'Knäböj kroppsvikt', tags: ['Ben', 'Kroppsvikt'], primaryMuscle: 'Ben', primarySubMuscles: ['Framsida lår'], secondaryMuscles: [] },
  { id: 'mountain-climbers', name: 'Mountain climbers', tags: ['Mage', 'Ben', 'Kroppsvikt'], primaryMuscle: 'Mage', secondaryMuscles: ['Ben'] },
  { id: 'glute-bridge', name: 'Skattskyffel', tags: ['Säte', 'Ben', 'Kroppsvikt'], primaryMuscle: 'Säte', secondaryMuscles: ['Ben'] },
];
const GYM_EQUIPMENT_TAGS: string[] = ['Fria vikter', 'Maskin', 'Kroppsvikt', 'Kabel'];
const GYM_EQUIPMENT_SET = new Set(GYM_EQUIPMENT_TAGS);

const MUSCLE_SUBGROUPS: Record<string, string[]> = {
  'Ben': ['Framsida lår', 'Baksida lår', 'Insida lår'],
  'Rygg': ['Övre rygg', 'Ländrygg', 'Latissimus dorsi', 'Trapezius'],
  'Bröst': ['Övre bröst', 'Mellersta bröst', 'Nedre bröst'],
  'Axlar': ['Främre deltoid', 'Sidodeltoid', 'Bakre deltoid'],
};
const SUB_TO_GROUP = new Map(
  Object.entries(MUSCLE_SUBGROUPS).flatMap(([group, subs]) => subs.map((sub) => [sub, group] as const)),
);
const MUSCLE_GROUP_ORDER: string[] = ['Bröst', 'Axlar', 'Rygg', 'Ben', 'Biceps', 'Triceps', 'Säte', 'Underarm', 'Vader', 'Mage'];
const BUILTIN_TAGS = new Set<string>([
  ...GYM_EQUIPMENT_TAGS,
  ...MUSCLE_GROUP_ORDER,
  ...Object.keys(MUSCLE_SUBGROUPS),
  ...Object.values(MUSCLE_SUBGROUPS).flat(),
]);
const muscleGroupSortIndex = (tag: string) => {
  const idx = MUSCLE_GROUP_ORDER.indexOf(tag);
  return idx >= 0 ? idx : MUSCLE_GROUP_ORDER.length;
};

/** Merges persisted gym library with default list: default exercises always included (new in app updates), user tag edits from persisted kept, custom exercises (Egen / gym-custom-*) appended. */
const EQUIPMENT_AND_META_TAGS = new Set(['Maskin', 'Fria vikter', 'Kabel', 'Kroppsvikt', 'Egen']);

function normalizeLibraryExercise(
  entry: Partial<LibraryExercise> | null | undefined,
  fallback?: LibraryExercise,
): LibraryExercise | null {
  if (!entry && !fallback) return null;
  const id = (entry?.id ?? fallback?.id ?? '').trim();
  const name = (entry?.name ?? fallback?.name ?? '').trim();
  if (!id || !name) return null;
  const rawTags = Array.isArray(entry?.tags) ? entry?.tags : fallback?.tags ?? [];
  const normalizedTags = [...new Set(
    rawTags
      .map((tag) => normalizeCategoryTag(String(tag)))
      .filter(Boolean),
  )];
  const fallbackTags = fallback?.tags ?? [];
  const tags = normalizedTags.length > 0 ? normalizedTags : fallbackTags;

  let primaryMuscle = entry?.primaryMuscle ?? fallback?.primaryMuscle ?? '';
  let secondaryMuscles = entry?.secondaryMuscles ?? fallback?.secondaryMuscles ?? [];
  const rawSubs = entry?.primarySubMuscles ?? fallback?.primarySubMuscles;
  let primarySubMuscles: string[] = Array.isArray(rawSubs) ? rawSubs : (typeof rawSubs === 'string' && rawSubs ? [rawSubs] : []);
  const secondarySubMuscles = entry?.secondarySubMuscles ?? fallback?.secondarySubMuscles ?? {};
  if (!primaryMuscle) {
    const muscleTags = tags.filter((tag) => !EQUIPMENT_AND_META_TAGS.has(tag));
    const firstTag = muscleTags[0] ?? '';
    const parentGroup = SUB_TO_GROUP.get(firstTag);
    if (parentGroup) {
      primaryMuscle = parentGroup;
      return { id, name, tags, primaryMuscle, primarySubMuscles: [firstTag], secondaryMuscles: muscleTags.slice(1), secondarySubMuscles };
    }
    primaryMuscle = firstTag;
    secondaryMuscles = muscleTags.slice(1);
  }
  const promotedGroup = SUB_TO_GROUP.get(primaryMuscle);
  if (promotedGroup) {
    if (primarySubMuscles.length === 0) primarySubMuscles = [primaryMuscle];
    primaryMuscle = promotedGroup;
    secondaryMuscles = secondaryMuscles.filter((m) => m !== promotedGroup);
  }

  return { id, name, tags, primaryMuscle, primarySubMuscles, secondaryMuscles, secondarySubMuscles };
}

function mergeGymLibrary(persisted: LibraryExercise[]): LibraryExercise[] {
  const persistedById = new Map(persisted.map((e) => [e.id, e]));
  const defaultIds = new Set(GYM_LIBRARY_EXERCISES.map((e) => e.id));
  const result: LibraryExercise[] = [];
  for (const def of GYM_LIBRARY_EXERCISES) {
    const merged = normalizeLibraryExercise(persistedById.get(def.id), def) ?? def;
    result.push(merged);
  }
  for (const p of persisted) {
    if (defaultIds.has(p.id)) continue;
    const normalized = normalizeLibraryExercise(p);
    if (normalized) result.push(normalized);
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
const MAX_MINUTES_IN_DAY = 23 * 60 + 59;
const formatClockTime = (hours: number, minutes: number) =>
  `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
const addHoursWithSameDayCap = (timeValue: string, hourDelta: number) => {
  const parsed = parseReminderTime(timeValue) ?? { hours: 9, minutes: 0, canonicalTime: '09:00' };
  const total = parsed.hours * 60 + parsed.minutes + hourDelta * 60;
  const capped = Math.max(0, Math.min(MAX_MINUTES_IN_DAY, total));
  return formatClockTime(Math.floor(capped / 60), capped % 60);
};
const shiftClockTime = (timeValue: string, hourDelta: number, minuteDelta: number) => {
  const parsed = parseReminderTime(timeValue) ?? { hours: 9, minutes: 0, canonicalTime: '09:00' };
  const minutesInDay = 24 * 60;
  const shiftedTotal =
    (parsed.hours * 60 + parsed.minutes + hourDelta * 60 + minuteDelta + minutesInDay * 2) % minutesInDay;
  return formatClockTime(Math.floor(shiftedTotal / 60), shiftedTotal % 60);
};
const normalizeCategoryTag = (value: string) => value.trim().replace(/\s+/g, ' ');
function stripTagFromExercise(e: LibraryExercise, tag: string): LibraryExercise {
  const newTags = e.tags.filter((t) => t !== tag);
  const newPrimarySubs = (e.primarySubMuscles ?? []).filter((s) => s !== tag);
  const newSecondarySubs = { ...(e.secondarySubMuscles ?? {}) };
  Object.keys(newSecondarySubs).forEach((k) => {
    newSecondarySubs[k] = newSecondarySubs[k].filter((s) => s !== tag);
    if (newSecondarySubs[k].length === 0) delete newSecondarySubs[k];
  });
  delete newSecondarySubs[tag];
  const newSecondary = (e.secondaryMuscles ?? []).filter((m) => m !== tag);
  const primary = e.primaryMuscle === tag ? '' : e.primaryMuscle;
  const pSubs = e.primaryMuscle === tag ? [] : newPrimarySubs;
  return { ...e, tags: newTags, primaryMuscle: primary, primarySubMuscles: pSubs, secondaryMuscles: newSecondary, secondarySubMuscles: Object.keys(newSecondarySubs).length > 0 ? newSecondarySubs : undefined };
}
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

function ExercisePreviewModal({
  exercise,
  onClose,
  onEditCategory,
}: {
  exercise: LibraryExercise | null;
  onClose: () => void;
  onEditCategory: (exercise: LibraryExercise) => void;
}) {
  const imageSource = exercise ? EXERCISE_IMAGE_SOURCES[exercise.id] : undefined;
  return (
    <Modal visible={!!exercise} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.timePickerBackdrop}>
        <View style={[styles.timePickerCard, styles.exercisePreviewCard]}>
          <View style={styles.exercisePreviewHeader}>
            <Text style={styles.exercisePreviewTitle}>{exercise?.name ?? ''}</Text>
            <Pressable style={styles.exercisePreviewCloseButton} onPress={onClose}>
              <MaterialIcons name="close" size={22} color="#DCE4EC" />
            </Pressable>
          </View>
          <View style={styles.exercisePreviewImageFrame}>
            {imageSource ? (
              <Image source={imageSource} style={styles.exercisePreviewImage} resizeMode="contain" />
            ) : (
              <View style={styles.exercisePreviewPlaceholder}>
                <MaterialCommunityIcons name="image-plus" size={36} color="#8FA1B3" />
                <Text style={styles.exercisePreviewPlaceholderText}>Bild kommer snart</Text>
              </View>
            )}
          </View>
          {exercise ? (
            <Button
              mode="contained"
              onPress={() => {
                onClose();
                requestAnimationFrame(() => onEditCategory(exercise));
              }}
              contentStyle={styles.exercisePreviewCategoryButton}
            >
              Redigera kategori för denna övning
            </Button>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

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
  const [quickLogConfirmExercise, setQuickLogConfirmExercise] = useState<{ id: string; title: string } | null>(null);
  const swipeableRefs = useRef(new Map<string, Swipeable | null>());
  const openSwipeIdRef = useRef<string | null>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const titleOpacity = scrollY.interpolate({
    inputRange: [0, TITLE_FADE_SCROLL_DISTANCE],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

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
      if (Platform.OS === 'android') {
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
        return;
      }
      if (Platform.OS === 'ios') {
        if (!(await requestIosNotificationPermission())) {
          Alert.alert('Test misslyckades', 'Notisbehörighet nekad.');
          return;
        }
        await ensureIosNotificationCategoryConfigured();
        const triggerAt = new Date(Date.now() + 60 * 1000);
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Manuell testövning',
            body: '1 x 1',
            sound: true,
            categoryIdentifier: IOS_REMINDER_CATEGORY_ID,
            data: {
              exerciseId: 'manual-test-ios',
              scheduleId: `manual-test-ios-${triggerAt.getTime()}`,
              scheduledAtIso: triggerAt.toISOString(),
              sets: 1,
              reps: 1,
            },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: triggerAt,
          },
        });
        Alert.alert('iOS test schemalagd', 'Notis om ca 60 sek.');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Test misslyckades', `Notistest felade: ${msg}`);
    }
  };

  const runInstantNotificationTest = async () => {
    try {
      if (Platform.OS === 'android') {
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
        return;
      }
      if (Platform.OS === 'ios') {
        if (!(await requestIosNotificationPermission())) {
          Alert.alert('Test misslyckades', 'Notisbehörighet nekad.');
          return;
        }
        await ensureIosNotificationCategoryConfigured();
        const triggerAt = new Date(Date.now() + 3 * 1000);
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Manuell testövning',
            body: '1 x 1',
            sound: true,
            categoryIdentifier: IOS_REMINDER_CATEGORY_ID,
            data: {
              exerciseId: 'manual-test-now-ios',
              scheduleId: `manual-now-ios-${triggerAt.getTime()}`,
              scheduledAtIso: triggerAt.toISOString(),
              sets: 1,
              reps: 1,
            },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: triggerAt,
          },
        });
        Alert.alert('iOS test (snabb)', 'Notis om ca 3 sek.');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Test misslyckades', `Notistest felade: ${msg}`);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={[styles.titleOverlay, { paddingTop: insets.top, paddingHorizontal: 16 }]}>
        <Animated.Text style={[styles.screenTitle, { opacity: titleOpacity }]}>PTRLogger</Animated.Text>
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
      </View>
      {exercises.length === 0 ? (
        <View style={[styles.emptyState, { paddingTop: TITLE_FADE_SCROLL_DISTANCE }]}>
          <Text style={styles.emptyTitle}>Inga övningar ännu</Text>
          <Text style={styles.emptySubtitle}>Tryck på ＋ för att lägga till din första övning</Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.listContent, { paddingTop: TITLE_FADE_SCROLL_DISTANCE }]}
          onTouchEnd={() => closeAllSwipes()}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: false },
          )}
          scrollEventThrottle={16}
        >
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
                    onPress={() => setQuickLogConfirmExercise({ id: exercise.id, title: exercise.title })}
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

      <Modal visible={!!quickLogConfirmExercise} transparent animationType="fade" onRequestClose={() => setQuickLogConfirmExercise(null)}>
        <View style={styles.timePickerBackdrop}>
          <View style={styles.timePickerCard}>
            <Text style={styles.timePickerTitle}>Logga övning</Text>
            <Text style={styles.confirmBody}>
              Vill du registrera att du gjort{'\n'}"{quickLogConfirmExercise?.title}"?
            </Text>
            <View style={styles.confirmActions}>
              <Button mode="outlined" textColor="#DCE4EC" onPress={() => setQuickLogConfirmExercise(null)}>
                Avbryt
              </Button>
              <Button mode="contained" onPress={() => { onQuickLog(quickLogConfirmExercise!.id); setQuickLogConfirmExercise(null); }}>
                Registrera
              </Button>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

function GymTrainingScreen({
  workoutPlans,
  setWorkoutPlans,
  completedWorkouts,
  setCompletedWorkouts,
  exerciseWeightPbs,
  setExerciseWeightPbs,
  gymLibraryExercises,
  setGymLibraryExercises,
  gymCustomMuscleGroups,
  setGymCustomMuscleGroups,
  showHomeTitle = true,
  disableTopInset = false,
  onFabActionChange,
  onActiveSessionChange,
  onRootViewChange,
}: {
  workoutPlans: WorkoutPlan[];
  setWorkoutPlans: React.Dispatch<React.SetStateAction<WorkoutPlan[]>>;
  completedWorkouts: CompletedWorkout[];
  setCompletedWorkouts: React.Dispatch<React.SetStateAction<CompletedWorkout[]>>;
  exerciseWeightPbs: ExerciseWeightPb[];
  setExerciseWeightPbs: React.Dispatch<React.SetStateAction<ExerciseWeightPb[]>>;
  gymLibraryExercises: LibraryExercise[];
  setGymLibraryExercises: React.Dispatch<React.SetStateAction<LibraryExercise[]>>;
  gymCustomMuscleGroups: string[];
  setGymCustomMuscleGroups: React.Dispatch<React.SetStateAction<string[]>>;
  showHomeTitle?: boolean;
  disableTopInset?: boolean;
  onFabActionChange: (action: (() => void) | null) => void;
  onActiveSessionChange: (active: boolean) => void;
  onRootViewChange?: (isRoot: boolean) => void;
}) {
  type TrainingView = 'home' | 'session' | 'builder' | 'saved' | 'planDetail' | 'historyDetail' | 'pbOverview' | 'preloaded';
  
  const insets = useSafeAreaInsets();
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
  const [builderEmptyAlertVisible, setBuilderEmptyAlertVisible] = useState(false);
  const [sessionConfirmVisible, setSessionConfirmVisible] = useState(false);
  const [sessionEmptyAlertVisible, setSessionEmptyAlertVisible] = useState(false);
  const [abortConfirmVisible, setAbortConfirmVisible] = useState(false);
  const [deletePlanTarget, setDeletePlanTarget] = useState<{ id: string; name: string; onDeleted?: () => void } | null>(null);
  const [historySelectionMode, setHistorySelectionMode] = useState(false);
  const [selectedHistoryWorkoutIds, setSelectedHistoryWorkoutIds] = useState<string[]>([]);
  const [deleteHistoryConfirmVisible, setDeleteHistoryConfirmVisible] = useState(false);
  const [selectedHistoryWorkout, setSelectedHistoryWorkout] = useState<CompletedWorkout | null>(null);
  const [openHistoryYears, setOpenHistoryYears] = useState<Record<string, boolean>>({});
  const [openHistoryMonthsByYear, setOpenHistoryMonthsByYear] = useState<Record<string, Record<string, boolean>>>({});
  const [gymCategoryEditorVisible, setGymCategoryEditorVisible] = useState(false);
  const [gymCategoryEditorExerciseId, setGymCategoryEditorExerciseId] = useState<string | null>(null);
  const [gymCategoryDraftPrimary, setGymCategoryDraftPrimary] = useState('');
  const [gymCategoryDraftPrimarySubs, setGymCategoryDraftPrimarySubs] = useState<string[]>([]);
  const gymSubSectionAnim = useRef(new Animated.Value(0)).current;
  const [gymCategoryDraftSecondary, setGymCategoryDraftSecondary] = useState<string[]>([]);
  const [gymCategoryDraftSecondarySubs, setGymCategoryDraftSecondarySubs] = useState<Record<string, string[]>>({});
  const [gymCategoryDraftEquipment, setGymCategoryDraftEquipment] = useState<string[]>([]);
  const [gymCategoryCustomInput, setGymCategoryCustomInput] = useState('');
  const [gymRemoveTagConfirm, setGymRemoveTagConfirm] = useState<{ tag: string; canRemove: boolean } | null>(null);
  const [gymLibraryVisible, setGymLibraryVisible] = useState(false);
  const [gymLibraryQuery, setGymLibraryQuery] = useState('');
  const [gymLibraryFilter, setGymLibraryFilter] = useState<string | null>(null);
  const [gymPreviewExercise, setGymPreviewExercise] = useState<LibraryExercise | null>(null);
  const [gymLibrarySubFilter, setGymLibrarySubFilter] = useState<string[]>([]);
  const [gymSubFilterDropdownOpen, setGymSubFilterDropdownOpen] = useState(false);
  const [gymLibraryEquipmentFilter, setGymLibraryEquipmentFilter] = useState<string | null>(null);
  const [gymLibraryListAtTop, setGymLibraryListAtTop] = useState(true);
  const gymLibraryModalRef = useRef<Modalize>(null);
  const gymLibraryListAtTopRef = useRef(true);
  const [pbModalExercise, setPbModalExercise] = useState<SessionExercise | null>(null);
  const [pbSortMode, setPbSortMode] = useState<PbSortMode>('reps_desc');
  const [pbSummaryVisible, setPbSummaryVisible] = useState(false);
  const [pbSummaryRows, setPbSummaryRows] = useState<
    { exerciseName: string; weightKg: number; oldBestReps: number; newBestReps: number }[]
  >([]);
  const [pbSummaryTotal, setPbSummaryTotal] = useState(0);
  const [sessionExerciseMenuId, setSessionExerciseMenuId] = useState<string | null>(null);
  const [builderExerciseMenuId, setBuilderExerciseMenuId] = useState<string | null>(null);
  const [builderExerciseMenuTop, setBuilderExerciseMenuTop] = useState<number>(100);
  const [sessionMoveMode, setSessionMoveMode] = useState(false);
  const [sessionMoveDraftOrder, setSessionMoveDraftOrder] = useState<string[] | null>(null);
  const [builderMoveMode, setBuilderMoveMode] = useState(false);
  const [builderMoveDraftOrder, setBuilderMoveDraftOrder] = useState<string[] | null>(null);
  const [sessionDraggingExerciseId, setSessionDraggingExerciseId] = useState<string | null>(null);
  const [builderDraggingExerciseId, setBuilderDraggingExerciseId] = useState<string | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  
  const sessionDragTranslateY = useRef(new Animated.Value(0)).current;
  const builderDragTranslateY = useRef(new Animated.Value(0)).current;
  const sessionMoveRowHeightRef = useRef(68);
  const builderMoveRowHeightRef = useRef(68);
  const sessionDragCurrentIndexRef = useRef(-1);
  const sessionDragHoverIndexRef = useRef(-1);
  const builderDragCurrentIndexRef = useRef(-1);
  const builderDragHoverIndexRef = useRef(-1);
  const sessionMoveDraftOrderRef = useRef<string[]>([]);
  const builderMoveDraftOrderRef = useRef<string[]>([]);
  const sessionMoveExerciseCountRef = useRef(0);
  const builderMoveExerciseCountRef = useRef(0);
  const sessionExerciseShiftAnims = useRef<Map<string, Animated.Value>>(new Map());
  const builderExerciseShiftAnims = useRef<Map<string, Animated.Value>>(new Map());
  const sessionMenuButtonRefs = useRef<Map<string, View | null>>(new Map());
  const builderMenuButtonRefs = useRef<Map<string, View | null>>(new Map());
  const sessionScrollRef = useRef<any>(null);
  const sessionPostReleaseRafRef = useRef<number | null>(null);
  const builderPostReleaseRafRef = useRef<number | null>(null);
  const sessionScrollYRef = useRef(0);
  const sessionScrollContentHeightRef = useRef(0);
  const sessionScrollViewportHeightRef = useRef(0);
  
  const cardBounceAnim = useRef(new Animated.Value(1)).current;
  const cardPressAnim = useRef(new Animated.Value(1)).current;
  
  
  
  const [lastClosedView, setLastClosedView] = useState<Exclude<TrainingView, 'home'> | null>(null);
  const [pressedCardView, setPressedCardView] = useState<Exclude<TrainingView, 'home'> | null>(null);
  
  const trainingTitleScrollY = useRef(new Animated.Value(0)).current;
  const trainingTitleOpacity = trainingTitleScrollY.interpolate({
    inputRange: [0, TITLE_FADE_SCROLL_DISTANCE],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  // När användaren går tillbaka till home: återställ scroll så att titeln "Träning" syns igen
  useEffect(() => {
    if (view === 'home') {
      trainingTitleScrollY.setValue(0);
    }
  }, [view, trainingTitleScrollY]);

  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  const animateTrainingLayout = useCallback(() => {
    LayoutAnimation.configureNext({
      duration: 220,
      create: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
      update: {
        type: LayoutAnimation.Types.easeInEaseOut,
      },
      delete: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
    });
  }, []);

  const SESSION_STORAGE_KEY = 'naphab_active_session_v1';
  const workoutMonthFormatter = useMemo(() => new Intl.DateTimeFormat('sv-SE', { month: 'long' }), []);
  const groupedCompletedWorkouts = useMemo(() => {
    const years = new Map<number, Map<number, CompletedWorkout[]>>();
    completedWorkouts.forEach((workout) => {
      const date = new Date(workout.startedAtIso);
      if (Number.isNaN(date.getTime())) return;
      const year = date.getFullYear();
      const month = date.getMonth();
      if (!years.has(year)) years.set(year, new Map<number, CompletedWorkout[]>());
      const months = years.get(year)!;
      if (!months.has(month)) months.set(month, []);
      months.get(month)!.push(workout);
    });
    return Array.from(years.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([year, months]) => ({
        year,
        workoutCount: Array.from(months.values()).reduce((sum, rows) => sum + rows.length, 0),
        months: Array.from(months.entries())
          .sort((a, b) => b[0] - a[0])
          .map(([monthIndex, workouts]) => ({
            monthKey: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
            monthLabel: workoutMonthFormatter.format(new Date(year, monthIndex, 1)),
            workouts,
          })),
      }));
  }, [completedWorkouts, workoutMonthFormatter]);

  const toggleHistoryYear = useCallback((yearKey: string) => {
    setOpenHistoryYears((prev) => {
      const isOpen = !!prev[yearKey];
      if (!isOpen) return { ...prev, [yearKey]: true };
      const next = { ...prev };
      delete next[yearKey];
      return next;
    });
    setOpenHistoryMonthsByYear((prev) => {
      if (!prev[yearKey]) return prev;
      const next = { ...prev };
      delete next[yearKey];
      return next;
    });
  }, []);

  const toggleHistoryMonth = useCallback((yearKey: string, monthKey: string) => {
    setOpenHistoryMonthsByYear((prev) => {
      const yearMonths = prev[yearKey] ?? {};
      const isOpen = !!yearMonths[monthKey];
      if (!isOpen) {
        return {
          ...prev,
          [yearKey]: { ...yearMonths, [monthKey]: true },
        };
      }
      const nextYearMonths = { ...yearMonths };
      delete nextYearMonths[monthKey];
      if (Object.keys(nextYearMonths).length === 0) {
        const next = { ...prev };
        delete next[yearKey];
        return next;
      }
      return {
        ...prev,
        [yearKey]: nextYearMonths,
      };
    });
  }, []);

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
    if (Platform.OS === 'android') {
      if (sessionStartedAtIso) {
        showAndroidWorkoutNotification(sessionStartedAtIso).catch(() => {});
      } else {
        dismissAndroidWorkoutNotification().catch(() => {});
      }
      return;
    }
    if (Platform.OS === 'ios') {
      if (sessionStartedAtIso) {
        showIosWorkoutLiveActivity(sessionStartedAtIso).catch(() => {});
      } else {
        dismissIosWorkoutLiveActivity().catch(() => {});
      }
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

  useEffect(() => {
    onRootViewChange?.(view === 'home');
  }, [onRootViewChange, view]);

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
  const sessionRenderedExercises = useMemo(() => {
    if (!sessionMoveMode || !sessionMoveDraftOrder) return sessionExercises;
    const byId = new Map(sessionExercises.map((ex) => [ex.id, ex]));
    return sessionMoveDraftOrder.map((id) => byId.get(id)).filter((ex): ex is SessionExercise => !!ex);
  }, [sessionExercises, sessionMoveMode, sessionMoveDraftOrder]);
  const getOrCreateShiftAnim = useCallback((exerciseId: string) => {
    let anim = sessionExerciseShiftAnims.current.get(exerciseId);
    if (!anim) {
      anim = new Animated.Value(0);
      sessionExerciseShiftAnims.current.set(exerciseId, anim);
    }
    return anim;
  }, []);
  const animateSessionMoveShifts = useCallback((
    draggingExerciseId: string | null,
    startIndex: number,
    hoverIndex: number,
    immediate = false,
  ) => {
    const rowHeight = Math.max(sessionMoveRowHeightRef.current, 1);
    const draft = sessionMoveDraftOrderRef.current;
    draft.forEach((exerciseId, index) => {
      const shiftAnim = sessionExerciseShiftAnims.current.get(exerciseId);
      if (!shiftAnim || exerciseId === draggingExerciseId) return;
      let toValue = 0;
      if (hoverIndex > startIndex && index > startIndex && index <= hoverIndex) {
        toValue = -rowHeight;
      } else if (hoverIndex < startIndex && index >= hoverIndex && index < startIndex) {
        toValue = rowHeight;
      }
      if (immediate) {
        shiftAnim.stopAnimation();
        shiftAnim.setValue(toValue);
      } else {
        Animated.spring(shiftAnim, {
          toValue,
          useNativeDriver: true,
          damping: 20,
          stiffness: 280,
          mass: 0.35,
        }).start();
      }
    });
  }, []);
  const commitSessionDraftReorder = useCallback((fromIndex: number, toIndex: number) => {
    const draft = sessionMoveDraftOrderRef.current;
    if (
      fromIndex === toIndex
      || fromIndex < 0
      || toIndex < 0
      || fromIndex >= draft.length
      || toIndex >= draft.length
    ) {
      return;
    }
    const next = [...draft];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);
    sessionMoveDraftOrderRef.current = next;
    setSessionMoveDraftOrder(next);
  }, []);
  const removeSessionExercise = useCallback((exerciseId: string) => {
    animateTrainingLayout();
    setSessionExerciseMenuId((current) => (current === exerciseId ? null : current));
    setSessionDraggingExerciseId((current) => (current === exerciseId ? null : current));
    setSessionExercises((prev) => prev.filter((item) => item.id !== exerciseId));
  }, [animateTrainingLayout]);
  const closeSessionExerciseMenu = useCallback(() => {
    const wasLastExercise =
      sessionExerciseMenuId != null &&
      sessionExercises.length > 0 &&
      sessionExercises[sessionExercises.length - 1].id === sessionExerciseMenuId;
    animateTrainingLayout();
    setSessionExerciseMenuId(null);
    if (wasLastExercise) {
      requestAnimationFrame(() => {
        sessionScrollRef.current?.scrollToEnd?.({ animated: true });
      });
    }
  }, [animateTrainingLayout, sessionExerciseMenuId, sessionExercises]);
  const openSessionExerciseMenu = useCallback((exerciseId: string) => {
    animateTrainingLayout();
    setSessionExerciseMenuId(exerciseId);
  }, [animateTrainingLayout]);
  const enterSessionMoveMode = useCallback(() => {
    if (sessionExercises.length < 2) {
      Alert.alert('Minst två övningar behövs', 'Lägg till minst två övningar för att kunna flytta ordningen.');
      return;
    }
    if (sessionPostReleaseRafRef.current !== null) {
      cancelAnimationFrame(sessionPostReleaseRafRef.current);
      sessionPostReleaseRafRef.current = null;
    }
    const order = sessionExercises.map((ex) => ex.id);
    sessionMoveDraftOrderRef.current = order;
    sessionMoveExerciseCountRef.current = order.length;
    setSessionDraggingExerciseId(null);
    sessionDragCurrentIndexRef.current = -1;
    sessionDragHoverIndexRef.current = -1;
    sessionDragTranslateY.stopAnimation();
    sessionDragTranslateY.setValue(0);
    sessionExerciseShiftAnims.current.forEach((anim) => {
      anim.stopAnimation();
      anim.setValue(0);
    });
    animateTrainingLayout();
    closeSessionExerciseMenu();
    setSessionMoveDraftOrder(order);
    setSessionMoveMode(true);
  }, [animateTrainingLayout, closeSessionExerciseMenu, sessionDragTranslateY, sessionExercises]);
  const exitSessionMoveMode = useCallback(() => {
    const finalOrder = sessionMoveDraftOrderRef.current;
    animateTrainingLayout();
    closeSessionExerciseMenu();
    if (finalOrder.length > 0) {
      setSessionExercises((prev) => {
        const byId = new Map(prev.map((ex) => [ex.id, ex]));
        const reordered = finalOrder.map((id) => byId.get(id)).filter((ex): ex is SessionExercise => !!ex);
        const remaining = prev.filter((ex) => !finalOrder.includes(ex.id));
        return [...reordered, ...remaining];
      });
    }
    setSessionMoveMode(false);
    setSessionMoveDraftOrder(null);
    sessionMoveDraftOrderRef.current = [];
    sessionMoveExerciseCountRef.current = 0;
    setSessionDraggingExerciseId(null);
    sessionDragCurrentIndexRef.current = -1;
    sessionDragHoverIndexRef.current = -1;
    sessionExerciseShiftAnims.current.forEach((anim) => anim.setValue(0));
    sessionDragTranslateY.stopAnimation();
    sessionDragTranslateY.setValue(0);
  }, [animateTrainingLayout, closeSessionExerciseMenu, sessionDragTranslateY]);
  const sessionMovePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
      onMoveShouldSetPanResponderCapture: () => false,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        sessionDragTranslateY.stopAnimation();
        sessionDragTranslateY.setValue(0);
      },
      onPanResponderMove: (_, gesture) => {
        const rowHeight = Math.max(sessionMoveRowHeightRef.current, 1);
        const startIndex = sessionDragCurrentIndexRef.current;
        if (startIndex < 0) return;
        const maxIndex = sessionMoveExerciseCountRef.current - 1;
        const dragPosition = startIndex * rowHeight + gesture.dy;
        const hoverIndex = Math.max(0, Math.min(maxIndex, Math.round(dragPosition / rowHeight)));
        if (hoverIndex !== sessionDragHoverIndexRef.current) {
          sessionDragHoverIndexRef.current = hoverIndex;
          const draggingExerciseId = sessionMoveDraftOrderRef.current[startIndex] ?? null;
          animateSessionMoveShifts(draggingExerciseId, startIndex, hoverIndex);
        }
        sessionDragTranslateY.setValue(gesture.dy);
      },
      onPanResponderRelease: () => {
        const startIndex = sessionDragCurrentIndexRef.current;
        const hoverIndex = sessionDragHoverIndexRef.current;
        const rowHeight = Math.max(sessionMoveRowHeightRef.current, 1);
        const targetOffset = (hoverIndex - startIndex) * rowHeight;
        const draggingExerciseId = sessionMoveDraftOrderRef.current[startIndex] ?? null;
        animateSessionMoveShifts(draggingExerciseId, startIndex, hoverIndex, true);
        Animated.timing(sessionDragTranslateY, {
          toValue: targetOffset,
          useNativeDriver: true,
          duration: 110,
          easing: Easing.out(Easing.cubic),
        }).start(() => {
          commitSessionDraftReorder(startIndex, hoverIndex);
          setSessionDraggingExerciseId(null);
          sessionDragCurrentIndexRef.current = -1;
          sessionDragHoverIndexRef.current = -1;
          if (sessionPostReleaseRafRef.current !== null) {
            cancelAnimationFrame(sessionPostReleaseRafRef.current);
          }
          sessionPostReleaseRafRef.current = requestAnimationFrame(() => {
            sessionPostReleaseRafRef.current = null;
            if (sessionDragCurrentIndexRef.current !== -1) return;
            sessionExerciseShiftAnims.current.forEach((anim) => anim.setValue(0));
            sessionDragTranslateY.setValue(0);
          });
        });
      },
      onPanResponderTerminate: () => {
        animateSessionMoveShifts(null, 0, 0);
        Animated.spring(sessionDragTranslateY, {
          toValue: 0,
          useNativeDriver: true,
          damping: 18,
          stiffness: 220,
          mass: 0.35,
        }).start(() => {
          setSessionDraggingExerciseId(null);
          sessionDragCurrentIndexRef.current = -1;
          sessionDragHoverIndexRef.current = -1;
        });
      },
    }),
  ).current;
  const startDraggingExercise = useCallback((exerciseId: string, index: number) => {
    if (sessionPostReleaseRafRef.current !== null) {
      cancelAnimationFrame(sessionPostReleaseRafRef.current);
      sessionPostReleaseRafRef.current = null;
    }
    closeSessionExerciseMenu();
    setSessionDraggingExerciseId(exerciseId);
    sessionDragCurrentIndexRef.current = index;
    sessionDragHoverIndexRef.current = index;
    sessionExerciseShiftAnims.current.forEach((anim) => anim.setValue(0));
    sessionDragTranslateY.stopAnimation();
    sessionDragTranslateY.setValue(0);
    animateSessionMoveShifts(exerciseId, index, index);
  }, [animateSessionMoveShifts, closeSessionExerciseMenu, sessionDragTranslateY]);
  const builderRenderedExercises = useMemo(() => {
    if (!builderMoveMode || !builderMoveDraftOrder) return builderExercises;
    const byId = new Map(builderExercises.map((ex) => [ex.id, ex]));
    return builderMoveDraftOrder.map((id) => byId.get(id)).filter((ex): ex is WorkoutPlanExercise => !!ex);
  }, [builderExercises, builderMoveDraftOrder, builderMoveMode]);
  const getOrCreateBuilderShiftAnim = useCallback((exerciseId: string) => {
    let anim = builderExerciseShiftAnims.current.get(exerciseId);
    if (!anim) {
      anim = new Animated.Value(0);
      builderExerciseShiftAnims.current.set(exerciseId, anim);
    }
    return anim;
  }, []);
  const animateBuilderMoveShifts = useCallback((
    draggingExerciseId: string | null,
    startIndex: number,
    hoverIndex: number,
    immediate = false,
  ) => {
    const rowHeight = Math.max(builderMoveRowHeightRef.current, 1);
    const draft = builderMoveDraftOrderRef.current;
    draft.forEach((exerciseId, index) => {
      const shiftAnim = builderExerciseShiftAnims.current.get(exerciseId);
      if (!shiftAnim || exerciseId === draggingExerciseId) return;
      let toValue = 0;
      if (hoverIndex > startIndex && index > startIndex && index <= hoverIndex) {
        toValue = -rowHeight;
      } else if (hoverIndex < startIndex && index >= hoverIndex && index < startIndex) {
        toValue = rowHeight;
      }
      if (immediate) {
        shiftAnim.stopAnimation();
        shiftAnim.setValue(toValue);
      } else {
        Animated.spring(shiftAnim, {
          toValue,
          useNativeDriver: true,
          damping: 20,
          stiffness: 280,
          mass: 0.35,
        }).start();
      }
    });
  }, []);
  const commitBuilderDraftReorder = useCallback((fromIndex: number, toIndex: number) => {
    const draft = builderMoveDraftOrderRef.current;
    if (
      fromIndex === toIndex
      || fromIndex < 0
      || toIndex < 0
      || fromIndex >= draft.length
      || toIndex >= draft.length
    ) {
      return;
    }
    const next = [...draft];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);
    builderMoveDraftOrderRef.current = next;
    setBuilderMoveDraftOrder(next);
  }, []);
  const removeBuilderExercise = useCallback((exerciseId: string) => {
    animateTrainingLayout();
    setBuilderExerciseMenuId((current) => (current === exerciseId ? null : current));
    setBuilderExerciseMenuTop(100);
    setBuilderDraggingExerciseId((current) => (current === exerciseId ? null : current));
    setBuilderExercises((prev) => prev.filter((item) => item.id !== exerciseId));
  }, [animateTrainingLayout, setBuilderExercises]);
  const closeBuilderExerciseMenu = useCallback(() => {
    setBuilderExerciseMenuId(null);
    setBuilderExerciseMenuTop(100);
  }, []);
  const openBuilderExerciseMenu = useCallback((exerciseId: string) => {
    const buttonRef = builderMenuButtonRefs.current.get(exerciseId);
    if (!buttonRef) {
      setBuilderExerciseMenuId(exerciseId);
      return;
    }
    buttonRef.measureInWindow((_x, y, _width, height) => {
      const screenHeight = Dimensions.get('window').height;
      const menuHeightEstimate = 220;
      const margin = 12;
      const bottomOverlayReserve = 112;
      const desiredTop = y + height + 6;
      const minTop = insets.top + margin;
      const maxTop = screenHeight - insets.bottom - bottomOverlayReserve - menuHeightEstimate - margin;
      const clampedTop = Math.max(minTop, Math.min(desiredTop, maxTop));
      setBuilderExerciseMenuTop(clampedTop);
      setBuilderExerciseMenuId(exerciseId);
    });
  }, [insets.bottom, insets.top]);
  const resolveBuilderExercisePbId = useCallback((exercise: WorkoutPlanExercise) => {
    if (exercise.libraryExerciseId) return exercise.libraryExerciseId;
    return `name:${exercise.name.trim().toLowerCase()}`;
  }, []);
  const enterBuilderMoveMode = useCallback(() => {
    if (builderExercises.length < 2) {
      Alert.alert('Minst två övningar behövs', 'Lägg till minst två övningar för att kunna flytta ordningen.');
      return;
    }
    if (builderPostReleaseRafRef.current !== null) {
      cancelAnimationFrame(builderPostReleaseRafRef.current);
      builderPostReleaseRafRef.current = null;
    }
    const order = builderExercises.map((ex) => ex.id);
    builderMoveDraftOrderRef.current = order;
    builderMoveExerciseCountRef.current = order.length;
    setBuilderDraggingExerciseId(null);
    builderDragCurrentIndexRef.current = -1;
    builderDragHoverIndexRef.current = -1;
    builderDragTranslateY.stopAnimation();
    builderDragTranslateY.setValue(0);
    builderExerciseShiftAnims.current.forEach((anim) => {
      anim.stopAnimation();
      anim.setValue(0);
    });
    animateTrainingLayout();
    closeBuilderExerciseMenu();
    setBuilderMoveDraftOrder(order);
    setBuilderMoveMode(true);
  }, [animateTrainingLayout, builderDragTranslateY, builderExercises, closeBuilderExerciseMenu]);
  const exitBuilderMoveMode = useCallback(() => {
    const finalOrder = builderMoveDraftOrderRef.current;
    animateTrainingLayout();
    closeBuilderExerciseMenu();
    if (finalOrder.length > 0) {
      setBuilderExercises((prev) => {
        const byId = new Map(prev.map((ex) => [ex.id, ex]));
        const reordered = finalOrder.map((id) => byId.get(id)).filter((ex): ex is WorkoutPlanExercise => !!ex);
        const remaining = prev.filter((ex) => !finalOrder.includes(ex.id));
        return [...reordered, ...remaining];
      });
    }
    setBuilderMoveMode(false);
    setBuilderMoveDraftOrder(null);
    builderMoveDraftOrderRef.current = [];
    builderMoveExerciseCountRef.current = 0;
    setBuilderDraggingExerciseId(null);
    builderDragCurrentIndexRef.current = -1;
    builderDragHoverIndexRef.current = -1;
    builderExerciseShiftAnims.current.forEach((anim) => anim.setValue(0));
    builderDragTranslateY.stopAnimation();
    builderDragTranslateY.setValue(0);
  }, [animateTrainingLayout, builderDragTranslateY, closeBuilderExerciseMenu]);
  const builderMovePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
      onMoveShouldSetPanResponderCapture: () => false,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        builderDragTranslateY.stopAnimation();
        builderDragTranslateY.setValue(0);
      },
      onPanResponderMove: (_, gesture) => {
        const rowHeight = Math.max(builderMoveRowHeightRef.current, 1);
        const startIndex = builderDragCurrentIndexRef.current;
        if (startIndex < 0) return;
        const maxIndex = builderMoveExerciseCountRef.current - 1;
        const dragPosition = startIndex * rowHeight + gesture.dy;
        const hoverIndex = Math.max(0, Math.min(maxIndex, Math.round(dragPosition / rowHeight)));
        if (hoverIndex !== builderDragHoverIndexRef.current) {
          builderDragHoverIndexRef.current = hoverIndex;
          const draggingExerciseId = builderMoveDraftOrderRef.current[startIndex] ?? null;
          animateBuilderMoveShifts(draggingExerciseId, startIndex, hoverIndex);
        }
        builderDragTranslateY.setValue(gesture.dy);
      },
      onPanResponderRelease: () => {
        const startIndex = builderDragCurrentIndexRef.current;
        const hoverIndex = builderDragHoverIndexRef.current;
        const rowHeight = Math.max(builderMoveRowHeightRef.current, 1);
        const targetOffset = (hoverIndex - startIndex) * rowHeight;
        const draggingExerciseId = builderMoveDraftOrderRef.current[startIndex] ?? null;
        animateBuilderMoveShifts(draggingExerciseId, startIndex, hoverIndex, true);
        Animated.timing(builderDragTranslateY, {
          toValue: targetOffset,
          useNativeDriver: true,
          duration: 110,
          easing: Easing.out(Easing.cubic),
        }).start(() => {
          commitBuilderDraftReorder(startIndex, hoverIndex);
          setBuilderDraggingExerciseId(null);
          builderDragCurrentIndexRef.current = -1;
          builderDragHoverIndexRef.current = -1;
          if (builderPostReleaseRafRef.current !== null) {
            cancelAnimationFrame(builderPostReleaseRafRef.current);
          }
          builderPostReleaseRafRef.current = requestAnimationFrame(() => {
            builderPostReleaseRafRef.current = null;
            if (builderDragCurrentIndexRef.current !== -1) return;
            builderExerciseShiftAnims.current.forEach((anim) => anim.setValue(0));
            builderDragTranslateY.setValue(0);
          });
        });
      },
      onPanResponderTerminate: () => {
        animateBuilderMoveShifts(null, 0, 0);
        Animated.spring(builderDragTranslateY, {
          toValue: 0,
          useNativeDriver: true,
          damping: 18,
          stiffness: 220,
          mass: 0.35,
        }).start(() => {
          setBuilderDraggingExerciseId(null);
          builderDragCurrentIndexRef.current = -1;
          builderDragHoverIndexRef.current = -1;
        });
      },
    }),
  ).current;
  const startDraggingBuilderExercise = useCallback((exerciseId: string, index: number) => {
    if (builderPostReleaseRafRef.current !== null) {
      cancelAnimationFrame(builderPostReleaseRafRef.current);
      builderPostReleaseRafRef.current = null;
    }
    closeBuilderExerciseMenu();
    setBuilderDraggingExerciseId(exerciseId);
    builderDragCurrentIndexRef.current = index;
    builderDragHoverIndexRef.current = index;
    builderExerciseShiftAnims.current.forEach((anim) => anim.setValue(0));
    builderDragTranslateY.stopAnimation();
    builderDragTranslateY.setValue(0);
    animateBuilderMoveShifts(exerciseId, index, index);
  }, [animateBuilderMoveShifts, builderDragTranslateY, closeBuilderExerciseMenu]);
  const confirmAbortWorkout = () => {
    setAbortConfirmVisible(true);
  };

  const openLibrary = useCallback((mode: 'session' | 'builder') => {
    setLibraryMode(mode);
    setGymCategoryEditorVisible(false);
    setGymLibraryListAtTop(true);
    gymLibraryListAtTopRef.current = true;
    setGymLibraryQuery('');
    setGymLibraryFilter(null);
    setGymLibrarySubFilter([]);
    setGymSubFilterDropdownOpen(false);
    setGymLibraryEquipmentFilter(null);
    setGymLibraryVisible(true);
    requestAnimationFrame(() => {
      gymLibraryModalRef.current?.open();
    });
  }, []);
  const onGymLibraryModalClosed = useCallback(() => {
    setGymLibraryVisible(false);
    setGymCategoryEditorVisible(false);
    setGymPreviewExercise(null);
    setLibraryMode(null);
  }, []);

  const addLibraryExercise = (exercise: LibraryExercise) => {
    if (!libraryMode) return;
    if (libraryMode === 'session') {
      setSessionExercises((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, libraryExerciseId: exercise.id, name: exercise.name, sets: [] }]);
    } else {
      setBuilderExercises((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, libraryExerciseId: exercise.id, name: exercise.name, sets: 1, reps: 0, repsPerSet: [0] }]);
    }
    setGymLibraryVisible(false);
    setLibraryMode(null);
    gymLibraryModalRef.current?.close();
  };
  const filteredGymLibrary = useMemo(() => {
    const query = gymLibraryQuery.trim().toLowerCase();
    return gymLibraryExercises.filter((exercise) => {
      const matchesQuery =
        query.length === 0 ||
        exercise.name.toLowerCase().includes(query) ||
        exercise.tags.some((tag) => tag.toLowerCase().includes(query));
      let matchesBody = true;
      if (gymLibrarySubFilter.length > 0) {
        matchesBody = gymLibrarySubFilter.some((sf) =>
          (exercise.primarySubMuscles ?? []).includes(sf)
          || Object.values(exercise.secondarySubMuscles ?? {}).some((subs) => subs.includes(sf)),
        );
      } else if (gymLibraryFilter) {
        matchesBody = exercise.primaryMuscle === gymLibraryFilter
          || exercise.secondaryMuscles?.includes(gymLibraryFilter)
          || exercise.tags.includes(gymLibraryFilter);
      }
      const matchesEquipment = !gymLibraryEquipmentFilter || exercise.tags.includes(gymLibraryEquipmentFilter);
      return matchesQuery && matchesBody && matchesEquipment;
    });
  }, [gymLibraryExercises, gymLibraryFilter, gymLibrarySubFilter, gymLibraryEquipmentFilter, gymLibraryQuery]);
  const gymBodyPartFilters = useMemo(
    () =>
      [...new Set([
        ...gymLibraryExercises.flatMap((e) => {
          const muscles = [e.primaryMuscle, ...(e.secondaryMuscles ?? [])].filter(Boolean) as string[];
          return muscles.length > 0 ? muscles : e.tags.filter((tag) => !GYM_EQUIPMENT_SET.has(tag) && tag !== 'Egen');
        }),
        ...gymCustomMuscleGroups,
      ])].sort((a, b) => muscleGroupSortIndex(a) - muscleGroupSortIndex(b) || a.localeCompare(b, 'sv')),
    [gymLibraryExercises, gymCustomMuscleGroups],
  );
  const gymMuscleChoicesForEditor = useMemo(() => {
    const customMuscles = [gymCategoryDraftPrimary, ...gymCategoryDraftSecondary].filter(
      (tag) => tag && !gymBodyPartFilters.includes(tag) && !GYM_EQUIPMENT_SET.has(tag) && tag !== 'Egen',
    );
    return [...new Set([...gymBodyPartFilters, ...customMuscles])].sort((a, b) => muscleGroupSortIndex(a) - muscleGroupSortIndex(b) || a.localeCompare(b, 'sv'));
  }, [gymBodyPartFilters, gymCategoryDraftPrimary, gymCategoryDraftSecondary]);
  const hasExactGymMatch = useMemo(() => {
    const query = gymLibraryQuery.trim().toLowerCase();
    if (query.length === 0) return true;
    return gymLibraryExercises.some((exercise) => exercise.name.toLowerCase() === query);
  }, [gymLibraryExercises, gymLibraryQuery]);
  const addCustomGymExercise = () => {
    const name = gymLibraryQuery.trim();
    if (!name) return;
    const alreadyExists = gymLibraryExercises.some((exercise) => exercise.name.toLowerCase() === name.toLowerCase());
    if (alreadyExists) {
      const existing = gymLibraryExercises.find((exercise) => exercise.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        addLibraryExercise(existing);
        setGymLibraryQuery('');
        setGymLibraryFilter(null);
        setGymLibrarySubFilter([]);
        setGymSubFilterDropdownOpen(false);
        setGymLibraryEquipmentFilter(null);
      }
      return;
    }
    const nextExercise: LibraryExercise = {
      id: `gym-custom-${Date.now()}`,
      name,
      tags: [],
      primaryMuscle: '',
      secondaryMuscles: [],
    };
    setGymLibraryExercises((prev) => [nextExercise, ...prev]);
    openGymCategoryEditor(nextExercise);
    setGymLibraryQuery('');
    setGymLibraryFilter(null);
    setGymLibrarySubFilter([]);
    setGymSubFilterDropdownOpen(false);
    setGymLibraryEquipmentFilter(null);
  };
  const syncGymDraftAfterRemove = (tag: string) => {
    if (gymCategoryDraftPrimary === tag) { setGymCategoryDraftPrimary(''); setGymCategoryDraftPrimarySubs([]); }
    setGymCategoryDraftPrimarySubs((prev) => prev.filter((s) => s !== tag));
    setGymCategoryDraftSecondary((prev) => prev.filter((t) => t !== tag));
    setGymCategoryDraftSecondarySubs((prev) => {
      const next = { ...prev };
      delete next[tag];
      Object.keys(next).forEach((k) => { next[k] = next[k].filter((s) => s !== tag); if (next[k].length === 0) delete next[k]; });
      return next;
    });
    setGymCategoryDraftEquipment((prev) => prev.filter((t) => t !== tag));
  };
  const removeGymTag = (_exercise: LibraryExercise, tag: string) => {
    setGymRemoveTagConfirm({ tag, canRemove: !BUILTIN_TAGS.has(tag) });
  };
  const confirmRemoveGymTag = () => {
    if (!gymRemoveTagConfirm?.canRemove) return;
    const tag = gymRemoveTagConfirm.tag;
    setGymRemoveTagConfirm(null);
    setGymLibraryExercises((prev) => prev.map((e) => stripTagFromExercise(e, tag)));
    setGymCustomMuscleGroups((prev) => prev.filter((g) => g !== tag));
    syncGymDraftAfterRemove(tag);
  };
  const openGymCategoryEditor = (exercise: LibraryExercise) => {
    setGymCategoryEditorExerciseId(exercise.id);
    setGymCategoryDraftPrimary(exercise.primaryMuscle ?? '');
    setGymCategoryDraftPrimarySubs(exercise.primarySubMuscles ?? []);
    setGymCategoryDraftSecondary(exercise.secondaryMuscles ?? []);
    setGymCategoryDraftSecondarySubs(exercise.secondarySubMuscles ?? {});
    setGymCategoryDraftEquipment(exercise.tags.filter((tag) => GYM_EQUIPMENT_SET.has(tag)));
    setGymCategoryCustomInput('');
    gymSubSectionAnim.setValue(exercise.primaryMuscle && MUSCLE_SUBGROUPS[exercise.primaryMuscle] ? 1 : 0);
    setGymCategoryEditorVisible(true);
  };
  const closeGymCategoryEditor = () => {
    setGymCategoryEditorVisible(false);
  };
  const addGymCustomCategory = () => {
    const next = normalizeCategoryTag(gymCategoryCustomInput);
    if (!next || GYM_EQUIPMENT_SET.has(next) || next === 'Egen') return;
    setGymCustomMuscleGroups((prev) => prev.includes(next) ? prev : [...prev, next]);
    if (!gymMuscleChoicesForEditor.includes(next)) {
      setGymCategoryDraftSecondary((prev) => prev.includes(next) ? prev : [...prev, next]);
    }
    setGymCategoryCustomInput('');
  };
  const saveGymCategoryEditor = () => {
    if (!gymCategoryEditorExerciseId) return;
    const primary = normalizeCategoryTag(gymCategoryDraftPrimary);
    if (!primary) {
      Alert.alert('Primär muskelgrupp saknas', 'Du måste välja en primär muskelgrupp.');
      return;
    }
    const validPrimarySubs = MUSCLE_SUBGROUPS[primary];
    const finalPrimarySubs = validPrimarySubs
      ? gymCategoryDraftPrimarySubs.filter((s) => validPrimarySubs.includes(s))
      : [];
    const secondary = gymCategoryDraftSecondary
      .map((tag) => normalizeCategoryTag(tag))
      .filter((tag) => tag && tag !== primary);
    const finalSecondarySubs: Record<string, string[]> = {};
    secondary.forEach((sec) => {
      const validSubs = MUSCLE_SUBGROUPS[sec];
      const drafted = gymCategoryDraftSecondarySubs[sec];
      if (validSubs && drafted?.length) {
        const filtered = drafted.filter((s) => validSubs.includes(s));
        if (filtered.length) finalSecondarySubs[sec] = filtered;
      }
    });
    const equipment = gymCategoryDraftEquipment
      .map((tag) => normalizeCategoryTag(tag))
      .filter(Boolean);
    const tags = [...new Set([primary, ...secondary, ...equipment])];
    setGymLibraryExercises((prev) =>
      prev.map((exercise) => (exercise.id === gymCategoryEditorExerciseId
        ? { ...exercise, tags, primaryMuscle: primary, primarySubMuscles: finalPrimarySubs, secondaryMuscles: secondary, secondarySubMuscles: Object.keys(finalSecondarySubs).length > 0 ? finalSecondarySubs : undefined }
        : exercise)),
    );
    setGymCategoryEditorVisible(false);
    setGymCategoryEditorExerciseId(null);
    setGymCategoryCustomInput('');
  };

  const scrollSessionToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const maxY = Math.max(0, sessionScrollContentHeightRef.current - sessionScrollViewportHeightRef.current);
        const currentY = sessionScrollYRef.current;
        if (maxY <= currentY + 2) return;
        const midY = currentY + (maxY - currentY) * 0.58;
        sessionScrollRef.current?.scrollTo?.({ y: midY, animated: true });
        setTimeout(() => {
          sessionScrollRef.current?.scrollTo?.({ y: maxY, animated: true });
        }, 170);
      });
    });
  }, []);
  const sessionAddSet = useCallback((exerciseId: string, shouldScrollToEnd = false) => {
    setSessionExercises((prev) =>
      prev.map((exercise) => {
        if (exercise.id !== exerciseId) return exercise;
        return {
          ...exercise,
          sets: [
            ...exercise.sets,
            {
              id: `${Date.now()}-${Math.random()}`,
              reps: 0,
              weightKg: 0,
            },
          ],
        };
      }),
    );
    if (shouldScrollToEnd) {
      scrollSessionToBottom();
    }
  }, [scrollSessionToBottom]);

  const sessionRemoveLastSet = (exerciseId: string) =>
    setSessionExercises((prev) =>
      prev.map((exercise) => {
        if (exercise.id !== exerciseId) return exercise;
        return { ...exercise, sets: exercise.sets.slice(0, -1) };
      }),
    );

  const sessionSetValue = (exerciseId: string, setId: string, field: 'reps' | 'weightKg', value: number) =>
    setSessionExercises((prev) =>
      prev.map((exercise) =>
        exercise.id !== exerciseId
          ? exercise
          : {
              ...exercise,
              sets: exercise.sets.map((setEntry) => {
                if (setEntry.id !== setId) return setEntry;
                if (field === 'reps') return { ...setEntry, reps: clampNumber(Math.round(value), 0, 50) };
                return { ...setEntry, weightKg: clampNumber(Math.round(value * WEIGHT_KEY_FACTOR) / WEIGHT_KEY_FACTOR, 0, 400) };
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
      setSessionEmptyAlertVisible(true);
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

  const closeGymLibrary = useCallback(() => {
    gymLibraryModalRef.current?.close();
  }, []);
  
  const runCardOpenTransition = useCallback((
    nextView: Exclude<TrainingView, 'home'>,
    beforeOpen?: () => void,
  ) => {
    beforeOpen?.();
    setLastClosedView(null);
    setView(nextView);
  }, []);

  

  const runCardBounce = useCallback(() => {
    cardBounceAnim.setValue(0.92);
    Animated.spring(cardBounceAnim, {
      toValue: 1,
      friction: 4,
      tension: 200,
      useNativeDriver: true,
    }).start();
  }, [cardBounceAnim]);

  const goHomeWithReverseTransition = useCallback(() => {
    if (view === 'home') return;
    const closingView = view as Exclude<TrainingView, 'home'>;
    const shouldClearSession = closingView === 'session' && sessionExercises.length === 0;
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
    setLastClosedView(closingView);
    runCardBounce();
  }, [runCardBounce, sessionExercises.length, view]);

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
  useEffect(() => {
    if (view === 'session') return;
    closeSessionExerciseMenu();
    setSessionMoveMode(false);
    setSessionMoveDraftOrder(null);
    sessionMoveDraftOrderRef.current = [];
    sessionMoveExerciseCountRef.current = 0;
    setSessionDraggingExerciseId(null);
    sessionDragCurrentIndexRef.current = -1;
    sessionDragHoverIndexRef.current = -1;
    sessionExerciseShiftAnims.current.forEach((anim) => anim.setValue(0));
    sessionDragTranslateY.setValue(0);
  }, [closeSessionExerciseMenu, sessionDragTranslateY, view]);
  useEffect(() => {
    if (view === 'builder') return;
    closeBuilderExerciseMenu();
    setBuilderMoveMode(false);
    setBuilderMoveDraftOrder(null);
    builderMoveDraftOrderRef.current = [];
    builderMoveExerciseCountRef.current = 0;
    setBuilderDraggingExerciseId(null);
    builderDragCurrentIndexRef.current = -1;
    builderDragHoverIndexRef.current = -1;
    builderExerciseShiftAnims.current.forEach((anim) => anim.setValue(0));
    builderDragTranslateY.setValue(0);
  }, [builderDragTranslateY, closeBuilderExerciseMenu, view]);
  const onGymLibraryListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const atTop = event.nativeEvent.contentOffset.y <= 4;
    gymLibraryListAtTopRef.current = atTop;
    setGymLibraryListAtTop(atTop);
    setGymSubFilterDropdownOpen(false);
  }, []);

  const builderSetSetReps = (exerciseId: string, setIndex: number, value: number) => {
    setBuilderExercises((prev) =>
      prev.map((e) => {
        if (e.id !== exerciseId) return e;
        const rp = getRepsPerSet(e);
        if (setIndex < 0 || setIndex >= rp.length) return e;
        const next = [...rp];
        next[setIndex] = clampNumber(Math.round(value), 0, 99);
        return { ...e, repsPerSet: next, sets: next.length, reps: next[0] ?? 0 };
      }),
    );
  };

  const builderAddSet = (exerciseId: string) => {
    setBuilderExercises((prev) =>
      prev.map((e) => {
        if (e.id !== exerciseId) return e;
        const rp = getRepsPerSet(e);
        const next = [...rp, 0];
        return { ...e, repsPerSet: next, sets: next.length, reps: next[0] ?? 0 };
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
        return { ...e, repsPerSet: next, sets: next.length, reps: next[0] ?? 0 };
      }),
    );
  };

  const saveBuilderPlan = () => {
    if (builderExercises.length === 0) {
      setBuilderEmptyAlertVisible(true);
      return;
    }
    setBuilderConfirmVisible(false);
    const name = builderName.trim() || `Pass ${new Intl.DateTimeFormat('sv-SE', { day: '2-digit', month: '2-digit' }).format(new Date())}`;
    const exercisesToSave = builderExercises.map((exercise) => {
      const rp = getRepsPerSet(exercise);
      return { ...exercise, repsPerSet: rp, sets: rp.length, reps: rp[0] ?? 0 };
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
      setBuilderEmptyAlertVisible(true);
      return;
    }
    setBuilderConfirmVisible(true);
  };

  const confirmDeletePlan = (planId: string, planName: string, onDeleted?: () => void) => {
    setDeletePlanTarget({ id: planId, name: planName, onDeleted });
  };

  const openSessionLibraryAction = useCallback(() => openLibrary('session'), [openLibrary]);
  const openBuilderLibraryAction = useCallback(() => openLibrary('builder'), [openLibrary]);
  const openBuilderFromHistoryAction = useCallback(() => {
    setView('builder');
    openLibrary('builder');
  }, [openLibrary]);
  const goToBuilderAction = useCallback(() => {
    setView('builder');
  }, []);
  useEffect(() => {
    if (view === 'session') {
      onFabActionChange(openSessionLibraryAction);
      return;
    }
    if (view === 'builder') {
      onFabActionChange(openBuilderLibraryAction);
      return;
    }
    if (view === 'historyDetail') {
      onFabActionChange(openBuilderFromHistoryAction);
      return;
    }
    if (view === 'planDetail') {
      onFabActionChange(null);
      return;
    }
    onFabActionChange(goToBuilderAction);
    return () => onFabActionChange(null);
  }, [goToBuilderAction, onFabActionChange, openBuilderFromHistoryAction, openBuilderLibraryAction, openSessionLibraryAction, openLibrary, view]);

  return (
    <View style={[styles.screen, { paddingTop: disableTopInset ? 0 : insets.top }]}>
      {showHomeTitle && view === 'home' ? (
        <View style={[styles.titleOverlay, { paddingTop: insets.top, paddingHorizontal: 16 }]}>
          <Animated.Text style={[styles.screenTitle, { opacity: trainingTitleOpacity }]}>Träning</Animated.Text>
        </View>
      ) : null}
      <View style={styles.trainingTransitionHost}>
        <View
          style={styles.trainingViewWrap}
        >
      {view === 'home' ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.listContent, { paddingTop: showHomeTitle ? TITLE_FADE_SCROLL_DISTANCE : 10 }]}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: trainingTitleScrollY } } }],
            { useNativeDriver: false },
          )}
          scrollEventThrottle={16}
        >
          {/* Primär kort: Starta träning / Fortsätt pågående */}
          {sessionStartedAtIso ? (
            <Animated.View style={{ transform: [{ scale: pulseAnim }, { scale: lastClosedView === 'session' ? cardBounceAnim : 1 }, { scale: pressedCardView === 'session' ? cardPressAnim : 1 }] }}>
              <Pressable
                style={styles.trainingHomeCard}
                onPress={() => runCardOpenTransition('session')}
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
              style={styles.trainingHomeCard}
              onPress={() => runCardOpenTransition('session', () => {
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
              style={styles.trainingHomeCardStacked}
              onPress={() => runCardOpenTransition('builder', () => {
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
              style={styles.trainingHomeCardStacked}
              onPress={() => runCardOpenTransition('saved')}
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
              style={styles.trainingHomeCardStacked}
              onPress={() => runCardOpenTransition('preloaded')}
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
              style={styles.trainingHomeCardStacked}
              onPress={() => runCardOpenTransition('pbOverview')}
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
                <Pressable style={styles.historyTrashButton} onPress={() => setDeleteHistoryConfirmVisible(true)}>
                  <MaterialIcons name="delete" size={22} color="#0F1419" />
                </Pressable>
              </View>
            ) : null}
          </View>
          {completedWorkouts.length === 0 ? <Text style={styles.loggedSetEmpty}>Inga sparade pass ännu.</Text> : null}
          {groupedCompletedWorkouts.map((yearGroup) => {
            const yearKey = String(yearGroup.year);
            const isYearOpen = !!openHistoryYears[yearKey];
            return (
              <View key={yearKey} style={styles.outdoorHistorySection}>
                <Pressable style={styles.trainingCard} onPress={() => toggleHistoryYear(yearKey)}>
                  <View style={styles.outdoorHistoryHeaderRow}>
                    <View style={styles.outdoorHistoryHeaderTextWrap}>
                      <Text style={styles.trainingTitle}>{yearGroup.year}</Text>
                      <Text style={styles.trainingMeta}>{yearGroup.workoutCount} pass</Text>
                    </View>
                    <MaterialIcons name={isYearOpen ? 'expand-more' : 'chevron-right'} size={22} color="#DCE4EC" />
                  </View>
                </Pressable>
                {isYearOpen ? (
                  <View style={styles.outdoorHistoryMonthsList}>
                    {yearGroup.months.map((monthGroup) => {
                      const isMonthOpen = !!openHistoryMonthsByYear[yearKey]?.[monthGroup.monthKey];
                      return (
                        <View key={monthGroup.monthKey} style={styles.outdoorHistorySection}>
                          <Pressable style={[styles.trainingCard, styles.outdoorHistoryMonthCard]} onPress={() => toggleHistoryMonth(yearKey, monthGroup.monthKey)}>
                            <View style={styles.outdoorHistoryHeaderRow}>
                              <View style={styles.outdoorHistoryHeaderTextWrap}>
                                <Text style={styles.trainingTitle}>{monthGroup.monthLabel}</Text>
                                <Text style={styles.trainingMeta}>{monthGroup.workouts.length} pass</Text>
                              </View>
                              <MaterialIcons name={isMonthOpen ? 'expand-more' : 'chevron-right'} size={22} color="#DCE4EC" />
                            </View>
                          </Pressable>
                          {isMonthOpen ? (
                            <View style={styles.outdoorHistoryRunsList}>
                              {monthGroup.workouts.map((workout) => (
                                <Pressable
                                  key={workout.id}
                                  style={[styles.trainingCard, styles.outdoorHistoryRunCard, selectedHistoryWorkoutIds.includes(workout.id) && styles.historySelectedCard]}
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
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })}
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
          <KeyboardAwareScrollView
            innerRef={(ref) => { sessionScrollRef.current = ref; }}
            contentContainerStyle={[styles.listContent, { paddingBottom: 240 + insets.bottom }]}
            scrollEnabled={!(sessionMoveMode && !!sessionDraggingExerciseId)}
            scrollEventThrottle={16}
            onScroll={(event) => {
              sessionScrollYRef.current = event.nativeEvent.contentOffset.y;
            }}
            onContentSizeChange={(_w, h) => {
              sessionScrollContentHeightRef.current = h;
            }}
            onLayout={(event) => {
              sessionScrollViewportHeightRef.current = event.nativeEvent.layout.height;
            }}
            extraScrollHeight={120}
            enableOnAndroid
            enableResetScrollToCoords={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {sessionMoveMode ? (
              <View style={styles.sessionMoveBanner}>
                <View style={styles.sessionMoveBannerTextWrap}>
                  <Text style={styles.sessionMoveBannerTitle}>Flytta övningar</Text>
                  <Text style={styles.sessionMoveBannerSubtitle}>Dra i handtaget för att ändra ordningen.</Text>
                </View>
                <Pressable style={styles.sessionMoveDoneButton} onPress={exitSessionMoveMode}>
                  <Text style={styles.sessionMoveDoneButtonText}>Klar</Text>
                </Pressable>
              </View>
            ) : null}
            {sessionRenderedExercises.length === 0 ? <Text style={styles.loggedSetEmpty}>Inga övningar än. Tryck på ＋.</Text> : null}
            {sessionRenderedExercises.map((exercise, exerciseIndex) => {
              const isDragging = sessionDraggingExerciseId === exercise.id;
              const handleLocked = !!sessionDraggingExerciseId && !isDragging;
              const shiftAnim = getOrCreateShiftAnim(exercise.id);
              return (
                <Animated.View
                  key={exercise.id}
                  onLayout={(event) => {
                    if (!sessionMoveMode) return;
                    sessionMoveRowHeightRef.current = event.nativeEvent.layout.height + 12;
                  }}
                  style={[
                    styles.trainingCard,
                    sessionMoveMode && styles.trainingCardCollapsed,
                    isDragging && styles.trainingCardDragging,
                    {
                      transform: [
                        { translateY: isDragging ? sessionDragTranslateY : shiftAnim },
                      ],
                    },
                  ]}
                >
                  <View style={styles.trainingHeader}>
                    <View style={styles.trainingTitlePressable}>
                      <Text style={styles.trainingTitle} numberOfLines={1}>{exercise.name}</Text>
                    </View>
                    {sessionMoveMode ? (
                      <View
                        style={[
                          styles.sessionMoveHandle,
                          isDragging && styles.sessionMoveHandleActive,
                          handleLocked && styles.sessionMoveHandleDisabled,
                        ]}
                        onStartShouldSetResponder={() => true}
                        onTouchStart={() => {
                          if (handleLocked) return;
                          startDraggingExercise(exercise.id, exerciseIndex);
                        }}
                        {...sessionMovePanResponder.panHandlers}
                      >
                        <MaterialCommunityIcons name="drag-horizontal-variant" size={22} color="#DCE4EC" />
                      </View>
                    ) : sessionExerciseMenuId === exercise.id ? (
                      <Pressable
                        style={styles.trainingMiniMenuButton}
                        onPress={() => closeSessionExerciseMenu()}
                      >
                        <MaterialIcons name="arrow-back" size={18} color="#DCE4EC" />
                      </Pressable>
                    ) : (
                      <Pressable
                        style={styles.trainingMiniMenuButton}
                        onPress={() => openSessionExerciseMenu(exercise.id)}
                      >
                        <MaterialCommunityIcons name="dots-horizontal" size={20} color="#DCE4EC" />
                      </Pressable>
                    )}
                  </View>
                  {sessionMoveMode ? null : sessionExerciseMenuId === exercise.id ? (
                    <View style={styles.sessionInlineMenu}>
                      <Pressable
                        style={styles.sessionInlineMenuItem}
                        onPress={() => {
                          const id = exercise.id;
                          closeSessionExerciseMenu();
                          removeSessionExercise(id);
                        }}
                      >
                        <View style={[styles.sessionInlineMenuIcon, { backgroundColor: 'rgba(239,154,154,0.12)' }]}>
                          <MaterialIcons name="delete-outline" size={18} color="#EF9A9A" />
                        </View>
                        <Text style={[styles.sessionInlineMenuText, { color: '#EF9A9A' }]}>Ta bort</Text>
                      </Pressable>
                      <Pressable
                        style={styles.sessionInlineMenuItem}
                        onPress={() => {
                          const ex = exercise;
                          closeSessionExerciseMenu();
                          openPbModal(ex);
                        }}
                      >
                        <View style={[styles.sessionInlineMenuIcon, { backgroundColor: 'rgba(220,228,236,0.08)' }]}>
                          <MaterialCommunityIcons name="trophy-outline" size={18} color="#DCE4EC" />
                        </View>
                        <Text style={styles.sessionInlineMenuText}>PBs</Text>
                      </Pressable>
                      <Pressable
                        style={styles.sessionInlineMenuItem}
                        onPress={() => {
                          closeSessionExerciseMenu();
                          enterSessionMoveMode();
                        }}
                      >
                        <View style={[styles.sessionInlineMenuIcon, { backgroundColor: 'rgba(220,228,236,0.08)' }]}>
                          <MaterialCommunityIcons name="drag-horizontal-variant" size={18} color="#DCE4EC" />
                        </View>
                        <Text style={styles.sessionInlineMenuText}>Flytta</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <>
                      <View style={styles.loggedSetList}>
                        {exercise.sets.length === 0 ? <Text style={styles.loggedSetEmpty}>Inga set ännu. Tryck på + Set.</Text> : null}
                        {exercise.sets.map((setEntry, index) => {
                          const feedback = sessionSetFeedbackBySetKey.get(`${exercise.id}|${setEntry.id}`);
                          return (
                            <View key={setEntry.id} style={styles.loggedSetRow}>
                              <View style={styles.loggedSetRowTop}>
                                <View style={styles.loggedSetRowMain}>
                                  <Text style={styles.loggedSetTitle}>Set {index + 1}</Text>
                                  <View style={styles.loggedSetMetrics}>
                                    <Text style={styles.loggedSetMetricLabel}>Reps</Text>
                                    <NumericStepperInput
                                      value={setEntry.reps}
                                      onChangeValue={(value) => sessionSetValue(exercise.id, setEntry.id, 'reps', value)}
                                      min={0}
                                      max={50}
                                      accessibilityLabel={`Reps för set ${index + 1}`}
                                    />
                                  </View>
                                  <View style={styles.loggedSetMetrics}>
                                    <Text style={styles.loggedSetMetricLabel}>Vikt</Text>
                                    <NumericStepperInput
                                      value={setEntry.weightKg}
                                      onChangeValue={(value) => sessionSetValue(exercise.id, setEntry.id, 'weightKg', value)}
                                      min={0}
                                      max={400}
                                      allowDecimal
                                      accessibilityLabel={`Vikt för set ${index + 1}`}
                                    />
                                  </View>
                                </View>
                                {feedback ? (
                                  <Pressable style={styles.pbFeedbackBoxInline} onPress={() => openPbModal(exercise)}>
                                    <Text style={styles.pbFeedbackTitle}>{feedback.kind === 'new' ? 'Nytt PB' : 'PB nu'}</Text>
                                  </Pressable>
                                ) : null}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                      <View style={styles.trainingButtons}>
                        <Button
                          mode="outlined"
                          disabled={exercise.sets.length === 0}
                          onPress={() => sessionRemoveLastSet(exercise.id)}
                        >− Set</Button>
                        <Button
                          mode="contained"
                          onPress={() => sessionAddSet(exercise.id, exerciseIndex === sessionRenderedExercises.length - 1)}
                        >
                          + Set
                        </Button>
                      </View>
                    </>
                  )}
                </Animated.View>
              );
            })}
            <View style={{ height: 160 }} />
          </KeyboardAwareScrollView>
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
          <KeyboardAwareScrollView
            contentContainerStyle={[styles.listContent, { paddingBottom: 240 + insets.bottom }]}
            onScrollBeginDrag={closeBuilderExerciseMenu}
            scrollEnabled={!(builderMoveMode && !!builderDraggingExerciseId)}
            extraScrollHeight={120}
            enableOnAndroid
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <TextInput value={builderName} onChangeText={setBuilderName} style={styles.input} placeholder="Namn på pass" placeholderTextColor={PLACEHOLDER_COLOR} />
            {builderMoveMode ? (
              <View style={styles.sessionMoveBanner}>
                <View style={styles.sessionMoveBannerTextWrap}>
                  <Text style={styles.sessionMoveBannerTitle}>Flytta övningar</Text>
                  <Text style={styles.sessionMoveBannerSubtitle}>Dra i handtaget för att ändra ordningen.</Text>
                </View>
                <Pressable style={styles.sessionMoveDoneButton} onPress={exitBuilderMoveMode}>
                  <Text style={styles.sessionMoveDoneButtonText}>Klar</Text>
                </Pressable>
              </View>
            ) : null}
            {builderRenderedExercises.length === 0 ? (
              <View style={styles.preloadedPlaceholderCard}>
                <MaterialCommunityIcons name="dumbbell" size={48} color="#8FA1B3" />
                <Text style={styles.preloadedPlaceholderTitle}>Inga övningar ännu</Text>
                <Text style={styles.preloadedPlaceholderText}>Tryck på ＋ för att lägga till övningar till ditt pass.</Text>
              </View>
            ) : null}
            {builderRenderedExercises.map((exercise, exerciseIndex) => {
              const repsArr = getRepsPerSet(exercise);
              const isDragging = builderDraggingExerciseId === exercise.id;
              const handleLocked = !!builderDraggingExerciseId && !isDragging;
              const shiftAnim = getOrCreateBuilderShiftAnim(exercise.id);
              return (
                <Animated.View
                  key={exercise.id}
                  onLayout={(event) => {
                    if (!builderMoveMode) return;
                    builderMoveRowHeightRef.current = event.nativeEvent.layout.height + 12;
                  }}
                  style={[
                    styles.trainingCard,
                    builderMoveMode && styles.trainingCardCollapsed,
                    isDragging && styles.trainingCardDragging,
                    {
                      transform: [
                        { translateY: isDragging ? builderDragTranslateY : shiftAnim },
                      ],
                    },
                  ]}
                >
                  <View style={styles.trainingHeader}>
                    <Text style={styles.trainingTitle}>{exercise.name}</Text>
                    {builderMoveMode ? (
                      <View
                        style={[
                          styles.sessionMoveHandle,
                          isDragging && styles.sessionMoveHandleActive,
                          handleLocked && styles.sessionMoveHandleDisabled,
                        ]}
                        onStartShouldSetResponder={() => true}
                        onTouchStart={() => {
                          if (handleLocked) return;
                          startDraggingBuilderExercise(exercise.id, exerciseIndex);
                        }}
                        {...builderMovePanResponder.panHandlers}
                      >
                        <MaterialCommunityIcons name="drag-horizontal-variant" size={22} color="#DCE4EC" />
                      </View>
                    ) : (
                      <Pressable
                        ref={(instance) => {
                          if (instance) {
                            builderMenuButtonRefs.current.set(exercise.id, instance);
                          } else {
                            builderMenuButtonRefs.current.delete(exercise.id);
                          }
                        }}
                        style={styles.trainingMiniMenuButton}
                        onPress={() => openBuilderExerciseMenu(exercise.id)}
                      >
                        <MaterialCommunityIcons name="dots-horizontal" size={20} color="#DCE4EC" />
                      </Pressable>
                    )}
                  </View>
                  {builderMoveMode ? null : (
                    <View style={{ paddingLeft: 12, paddingRight: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: '#253545' }}>
                      {repsArr.map((repsVal, setIdx) => (
                        <View key={setIdx} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                          <Text style={[styles.loggedSetMetricLabel, { minWidth: 36 }]}>Set {setIdx + 1}</Text>
                          <View style={styles.loggedSetMetrics}>
                            <Text style={styles.loggedSetMetricLabel}>Reps</Text>
                            <NumericStepperInput
                              value={repsVal}
                              onChangeValue={(value) => builderSetSetReps(exercise.id, setIdx, value)}
                              min={0}
                              max={99}
                              accessibilityLabel={`Reps för set ${setIdx + 1} i ${exercise.name}`}
                            />
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
                  )}
                </Animated.View>
              );
            })}
            <View style={{ height: 160 }} />
          </KeyboardAwareScrollView>
          {builderExerciseMenuId ? (
            <>
              <Pressable
                style={styles.sessionDropdownBackdrop}
                onPress={closeBuilderExerciseMenu}
              />
              <View style={[styles.sessionDropdownMenu, { top: builderExerciseMenuTop }]}>
                {(() => {
                  const menuExercise = builderRenderedExercises.find((ex) => ex.id === builderExerciseMenuId);
                  if (!menuExercise) return null;
                  const pbId = resolveBuilderExercisePbId(menuExercise);
                  return (
                    <>
                      <Text style={styles.sessionDropdownTitle}>{menuExercise.name}</Text>
                      <View style={styles.sessionDropdownDivider} />
                      <Pressable
                        style={styles.sessionDropdownItem}
                        onPress={() => {
                          const id = menuExercise.id;
                          closeBuilderExerciseMenu();
                          removeBuilderExercise(id);
                        }}
                      >
                        <MaterialIcons name="delete-outline" size={18} color="#EF9A9A" />
                        <Text style={[styles.sessionDropdownItemText, { color: '#EF9A9A' }]}>Ta bort övningen</Text>
                      </Pressable>
                      <Pressable
                        style={styles.sessionDropdownItem}
                        onPress={() => {
                          closeBuilderExerciseMenu();
                          openPbModalByExerciseId(pbId, menuExercise.name);
                        }}
                      >
                        <MaterialCommunityIcons name="trophy-outline" size={18} color="#DCE4EC" />
                        <Text style={styles.sessionDropdownItemText}>PBs</Text>
                      </Pressable>
                      <Pressable
                        style={styles.sessionDropdownItem}
                        onPress={() => {
                          closeBuilderExerciseMenu();
                          enterBuilderMoveMode();
                        }}
                      >
                        <MaterialCommunityIcons name="drag-horizontal-variant" size={18} color="#DCE4EC" />
                        <Text style={styles.sessionDropdownItemText}>Flytta</Text>
                      </Pressable>
                    </>
                  );
                })()}
              </View>
            </>
          ) : null}
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
            {workoutPlans.length === 0 ? (
              <View style={styles.preloadedPlaceholderCard}>
                <MaterialCommunityIcons name="clipboard-list-outline" size={48} color="#8FA1B3" />
                <Text style={styles.preloadedPlaceholderTitle}>Inga skapade pass ännu</Text>
                <Text style={styles.preloadedPlaceholderText}>Skapa ditt första pass via "Skapa pass" och det dyker upp här.</Text>
              </View>
            ) : null}
            {workoutPlans.map((plan) => (
              <Pressable key={plan.id} style={styles.trainingCard} onPress={() => openPlanDetail(plan)}>
                <Text style={styles.trainingTitle}>{plan.name}</Text>
                <View style={styles.savedPlanActionsRow}>
                  <Button mode="outlined" style={styles.savedPlanActionButton} onPress={() => openPlanDetail(plan)}>
                    Visa pass
                  </Button>
                  <Button mode="contained" style={styles.savedPlanActionButton} onPress={() => startWorkoutFromPlan(plan)}>
                    Starta pass
                  </Button>
                </View>
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
              <View style={styles.preloadedPlaceholderCard}>
                <MaterialCommunityIcons name="trophy-outline" size={48} color="#8FA1B3" />
                <Text style={styles.preloadedPlaceholderTitle}>Inga PB ännu</Text>
                <Text style={styles.preloadedPlaceholderText}>Spara ett pass med personliga rekord så dyker de upp här.</Text>
              </View>
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
        </View>
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

      <Modal visible={builderEmptyAlertVisible} transparent animationType="fade" onRequestClose={() => setBuilderEmptyAlertVisible(false)}>
        <View style={styles.timePickerBackdrop}>
          <View style={styles.timePickerCard}>
            <Text style={styles.timePickerTitle}>Inget att spara</Text>
            <Text style={styles.confirmBody}>Lägg till minst en övning innan du sparar passet.</Text>
            <View style={styles.confirmActions}>
              <Button mode="contained" onPress={() => setBuilderEmptyAlertVisible(false)}>OK</Button>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={sessionEmptyAlertVisible} transparent animationType="fade" onRequestClose={() => setSessionEmptyAlertVisible(false)}>
        <View style={styles.timePickerBackdrop}>
          <View style={styles.timePickerCard}>
            <Text style={styles.timePickerTitle}>Inget att spara</Text>
            <Text style={styles.confirmBody}>Lägg till minst en övning med minst ett set innan du sparar passet.</Text>
            <View style={styles.confirmActions}>
              <Button mode="contained" onPress={() => setSessionEmptyAlertVisible(false)}>OK</Button>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={abortConfirmVisible} transparent animationType="fade" onRequestClose={() => setAbortConfirmVisible(false)}>
        <View style={styles.timePickerBackdrop}>
          <View style={styles.timePickerCard}>
            <Text style={styles.timePickerTitle}>Avbryta pass?</Text>
            <Text style={styles.confirmBody}>Vill du avbryta passet? Passet sparas inte.</Text>
            <View style={styles.confirmActions}>
              <Button mode="outlined" textColor="#DCE4EC" onPress={() => setAbortConfirmVisible(false)}>
                Nej
              </Button>
              <Button mode="contained" buttonColor="#EF5350" textColor="#fff" onPress={() => { setAbortConfirmVisible(false); endSessionWithoutSaving(); }}>
                Avbryt pass
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!deletePlanTarget} transparent animationType="fade" onRequestClose={() => setDeletePlanTarget(null)}>
        <View style={styles.timePickerBackdrop}>
          <View style={styles.timePickerCard}>
            <Text style={styles.timePickerTitle}>Ta bort pass?</Text>
            <Text style={styles.confirmBody}>
              Vill du ta bort "{deletePlanTarget?.name}"?{'\n'}Det går inte att ångra.
            </Text>
            <View style={styles.confirmActions}>
              <Button mode="outlined" textColor="#DCE4EC" onPress={() => setDeletePlanTarget(null)}>
                Avbryt
              </Button>
              <Button mode="contained" buttonColor="#EF5350" textColor="#fff" onPress={() => { const t = deletePlanTarget; setDeletePlanTarget(null); if (t) { setWorkoutPlans((prev) => prev.filter((p) => p.id !== t.id)); t.onDeleted?.(); } }}>
                Ta bort
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={deleteHistoryConfirmVisible} transparent animationType="fade" onRequestClose={() => setDeleteHistoryConfirmVisible(false)}>
        <View style={styles.timePickerBackdrop}>
          <View style={styles.timePickerCard}>
            <Text style={styles.timePickerTitle}>Ta bort pass?</Text>
            <Text style={styles.confirmBody}>
              Vill du ta bort {selectedHistoryWorkoutIds.length} {selectedHistoryWorkoutIds.length === 1 ? 'pass' : 'pass'} från historiken?{'\n'}Det går inte att ångra.
            </Text>
            <View style={styles.confirmActions}>
              <Button mode="outlined" textColor="#DCE4EC" onPress={() => setDeleteHistoryConfirmVisible(false)}>
                Avbryt
              </Button>
              <Button mode="contained" buttonColor="#EF5350" textColor="#fff" onPress={() => { setDeleteHistoryConfirmVisible(false); deleteSelectedHistoryWorkouts(); }}>
                Ta bort
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      <Portal>
        <Modalize
          ref={gymLibraryModalRef}
          modalStyle={[styles.bottomSheet, styles.gymBottomSheet, styles.modalizeBottomSheet]}
          handleStyle={styles.bottomSheetHandle}
          useNativeDriver
          withHandle={false}
          panGestureEnabled={gymLibraryListAtTop}
          adjustToContentHeight={false}
          modalTopOffset={Math.round(Dimensions.get('window').height * 0.03)}
          threshold={LIBRARY_MODAL_CLOSE_THRESHOLD}
          velocity={LIBRARY_MODAL_CLOSE_VELOCITY}
          dragToss={LIBRARY_MODAL_DRAG_TOSS}
          closeAnimationConfig={LIBRARY_MODAL_CLOSE_ANIMATION_CONFIG}
          closeOnOverlayTap={false}
          onClosed={onGymLibraryModalClosed}
          flatListProps={{
            style: styles.libraryListScroll,
            data: filteredGymLibrary,
            keyExtractor: (exercise) => `gym-lib-${exercise.id}`,
            keyboardShouldPersistTaps: 'handled',
            showsVerticalScrollIndicator: false,
            onScroll: onGymLibraryListScroll,
            scrollEventThrottle: 16,
            bounces: true,
            overScrollMode: 'always',
            contentContainerStyle: styles.libraryList,
            ListHeaderComponent: (
              <View style={styles.gymSheetContent}>
                <Text style={styles.bottomSheetTitle}>Gymbibliotek</Text>
                <TextInput
                  value={gymLibraryQuery}
                  onChangeText={(text) => { setGymLibraryQuery(text); setGymSubFilterDropdownOpen(false); }}
                  style={[styles.input, styles.librarySearch]}
                  placeholder="Sök gymövning"
                  placeholderTextColor={PLACEHOLDER_COLOR}
                  onFocus={() => setGymSubFilterDropdownOpen(false)}
                />
                <RNScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.filterRow}
                  contentContainerStyle={styles.filterRowContent}
                >
                  <Pressable
                    key="gym-equipment-all"
                    style={[
                      styles.chip,
                      styles.gymFilterChipSmall,
                      gymLibraryEquipmentFilter === null && styles.chipActive,
                      gymLibraryEquipmentFilter === null && styles.gymFilterChipActive,
                    ]}
                    onPress={() => { setGymLibraryEquipmentFilter(null); setGymSubFilterDropdownOpen(false); }}
                  >
                    <Text style={[styles.chipText, styles.gymFilterChipTextSmall, gymLibraryEquipmentFilter === null && styles.chipTextActive]}>Alla</Text>
                  </Pressable>
                  {GYM_EQUIPMENT_TAGS.map((tag) => {
                    const active = gymLibraryEquipmentFilter === tag;
                    return (
                      <Pressable
                        key={`gym-equipment-${tag}`}
                        style={[styles.chip, styles.gymFilterChipSmall, active && styles.chipActive, active && styles.gymFilterChipActive]}
                        onPress={() => {
                          setGymLibraryEquipmentFilter((prev) => (prev === tag ? null : tag));
                          setGymSubFilterDropdownOpen(false);
                        }}
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
                    key="gym-body-all"
                    style={[
                      styles.chip,
                      styles.gymFilterChipSmall,
                      gymLibraryFilter === null && styles.chipActive,
                      gymLibraryFilter === null && styles.gymFilterChipActive,
                    ]}
                    onPress={() => { setGymLibraryFilter(null); setGymLibrarySubFilter([]); setGymSubFilterDropdownOpen(false); }}
                  >
                    <Text style={[styles.chipText, styles.gymFilterChipTextSmall, gymLibraryFilter === null && styles.chipTextActive]}>Alla</Text>
                  </Pressable>
                  {gymBodyPartFilters.map((tag) => {
                    const isSelected = gymLibraryFilter === tag;
                    const hasSubs = !!MUSCLE_SUBGROUPS[tag];
                    const subCount = gymLibrarySubFilter.length;
                    const chipLabel = isSelected && subCount === 1 ? gymLibrarySubFilter[0] : isSelected && subCount > 1 ? `${tag} (${subCount})` : tag;
                    return (
                      <Pressable
                        key={`gym-body-${tag}`}
                        style={[styles.chip, styles.gymFilterChipSmall, isSelected && styles.chipActive, isSelected && styles.gymFilterChipActive]}
                        onPress={() => {
                          if (gymLibraryFilter !== tag) {
                            setGymLibraryFilter(tag);
                            setGymLibrarySubFilter([]);
                            setGymSubFilterDropdownOpen(hasSubs);
                          } else if (hasSubs && !gymSubFilterDropdownOpen) {
                            setGymSubFilterDropdownOpen(true);
                          } else {
                            setGymLibraryFilter(null);
                            setGymLibrarySubFilter([]);
                            setGymSubFilterDropdownOpen(false);
                          }
                        }}
                      >
                        <Text style={[styles.chipText, styles.gymFilterChipTextSmall, isSelected && styles.chipTextActive]}>
                          {chipLabel}
                        </Text>
                        {hasSubs && isSelected && <Text style={styles.subFilterArrow}>▼</Text>}
                      </Pressable>
                    );
                  })}
                </RNScrollView>
                {gymSubFilterDropdownOpen && gymLibraryFilter && !!MUSCLE_SUBGROUPS[gymLibraryFilter] && (
                  <View style={styles.subFilterRow}>
                    {MUSCLE_SUBGROUPS[gymLibraryFilter].map((sub) => {
                      const subSel = gymLibrarySubFilter.includes(sub);
                      return (
                        <Pressable
                          key={sub}
                          style={[styles.chip, styles.subFilterChip, subSel && styles.chipActive]}
                          onPress={() => setGymLibrarySubFilter((prev) =>
                            prev.includes(sub) ? prev.filter((s) => s !== sub) : [...prev, sub],
                          )}
                        >
                          <Text style={[styles.chipText, styles.subFilterChipText, subSel && styles.chipTextActive]}>{sub}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
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
                    <Button mode="contained" onPress={addCustomGymExercise} contentStyle={styles.libraryItemButton} labelStyle={{ fontSize: 11 }}>
                      Lägg till
                    </Button>
                  </View>
                ) : null}
              </View>
            ),
            ListEmptyComponent: <Text style={styles.logEmpty}>Inga övningar matchar filtret.</Text>,
            renderItem: ({ item: exercise }) => (
              <View style={styles.libraryItem}>
                <Pressable style={styles.libraryItemTouchableMain} onPress={() => setGymPreviewExercise(exercise)}>
                  <Text style={styles.libraryName}>{exercise.name}</Text>
                  <View style={styles.libraryTagWrap}>
                    {exercise.tags.map((tag: string) => (
                      <View key={`${exercise.id}-${tag}`} style={styles.libraryTag}>
                        <Text style={styles.libraryTagText}>{tag}</Text>
                      </View>
                    ))}
                    {(exercise.primarySubMuscles ?? []).map((sub: string) => (
                      <View key={`${exercise.id}-psub-${sub}`} style={styles.libraryTagSub}>
                        <Text style={styles.libraryTagSubText}>{sub}</Text>
                      </View>
                    ))}
                    {Object.entries(exercise.secondarySubMuscles ?? {} as Record<string, string[]>).flatMap(([, subs]) =>
                      (subs as string[]).map((sub: string) => (
                        <View key={`${exercise.id}-ssub-${sub}`} style={styles.libraryTagSub}>
                          <Text style={styles.libraryTagSubText}>{sub}</Text>
                        </View>
                      )),
                    )}
                  </View>
                </Pressable>
                <Button mode="contained" onPress={() => addLibraryExercise(exercise)} contentStyle={styles.libraryItemButton} labelStyle={{ fontSize: 11 }}>
                  Välj
                </Button>
              </View>
            ),
          }}
        />
        <ExercisePreviewModal
          exercise={gymPreviewExercise}
          onClose={() => setGymPreviewExercise(null)}
          onEditCategory={openGymCategoryEditor}
        />
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
                  placeholder="Ny muskelgrupp"
                  placeholderTextColor={PLACEHOLDER_COLOR}
                />
                <Button mode="contained" onPress={addGymCustomCategory}>
                  Lägg till
                </Button>
              </View>
              <ScrollView style={styles.categoryDialogList} contentContainerStyle={styles.categoryChipListContent}>
                <Text style={styles.categorySectionLabel}>Primär muskelgrupp (obligatorisk)</Text>
                <View style={styles.categoryChipSection}>
                  <View style={styles.chipWrap}>
                    {gymMuscleChoicesForEditor.map((tag) => (
                      <Pressable
                        key={`gym-primary-${tag}`}
                        style={[styles.chip, gymCategoryDraftPrimary === tag && styles.chipActive]}
                        onPress={() => {
                          const next = gymCategoryDraftPrimary === tag ? '' : tag;
                          const willHaveSubs = !!MUSCLE_SUBGROUPS[next];
                          gymSubSectionAnim.setValue(willHaveSubs ? 0 : 1);
                          if (willHaveSubs) {
                            Animated.timing(gymSubSectionAnim, { toValue: 1, duration: 220, useNativeDriver: false }).start();
                          }
                          setGymCategoryDraftPrimary(next);
                          setGymCategoryDraftPrimarySubs([]);
                        }}
                        onLongPress={() => {
                          if (!gymCategoryEditorExerciseId) return;
                          const ex = gymLibraryExercises.find((e) => e.id === gymCategoryEditorExerciseId);
                          if (ex) removeGymTag(ex, tag);
                        }}
                      >
                        <Text style={[styles.chipText, gymCategoryDraftPrimary === tag && styles.chipTextActive]}>{tag}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {!!gymCategoryDraftPrimary && !!MUSCLE_SUBGROUPS[gymCategoryDraftPrimary] && (
                    <Animated.View style={[styles.inlineSubRow, { opacity: gymSubSectionAnim }]}>
                      {MUSCLE_SUBGROUPS[gymCategoryDraftPrimary].map((sub) => {
                        const subSel = gymCategoryDraftPrimarySubs.includes(sub);
                        return (
                          <Pressable
                            key={sub}
                            style={[styles.chip, styles.inlineSubChip, subSel && styles.chipActive]}
                            onPress={() => setGymCategoryDraftPrimarySubs((prev) =>
                              prev.includes(sub) ? prev.filter((s) => s !== sub) : [...prev, sub],
                            )}
                            onLongPress={() => {
                              if (!gymCategoryEditorExerciseId) return;
                              const ex = gymLibraryExercises.find((e) => e.id === gymCategoryEditorExerciseId);
                              if (ex) removeGymTag(ex, sub);
                            }}
                          >
                            <Text style={[styles.chipText, styles.inlineSubChipText, subSel && styles.chipTextActive]}>{sub}</Text>
                          </Pressable>
                        );
                      })}
                    </Animated.View>
                  )}
                </View>
                <Text style={styles.categorySectionLabel}>Sekundära muskelgrupper</Text>
                <View style={styles.categoryChipSection}>
                  <View style={styles.chipWrap}>
                    {gymMuscleChoicesForEditor.filter((tag) => tag !== gymCategoryDraftPrimary).map((tag) => (
                      <Pressable
                        key={`gym-secondary-${tag}`}
                        style={[styles.chip, gymCategoryDraftSecondary.includes(tag) && styles.chipActive]}
                        onPress={() =>
                          setGymCategoryDraftSecondary((prev) =>
                            prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag],
                          )
                        }
                        onLongPress={() => {
                          if (!gymCategoryEditorExerciseId) return;
                          const ex = gymLibraryExercises.find((e) => e.id === gymCategoryEditorExerciseId);
                          if (ex) removeGymTag(ex, tag);
                        }}
                      >
                        <Text style={[styles.chipText, gymCategoryDraftSecondary.includes(tag) && styles.chipTextActive]}>{tag}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {gymCategoryDraftSecondary.filter((tag) => !!MUSCLE_SUBGROUPS[tag]).map((tag) => (
                    <View key={`gym-sec-subs-${tag}`} style={styles.inlineSubSection}>
                      <Text style={styles.inlineSubLabel}>{tag}</Text>
                      <View style={styles.inlineSubRow}>
                        {MUSCLE_SUBGROUPS[tag].map((sub) => {
                          const subSel = (gymCategoryDraftSecondarySubs[tag] ?? []).includes(sub);
                          return (
                            <Pressable
                              key={sub}
                              style={[styles.chip, styles.inlineSubChip, subSel && styles.chipActive]}
                              onPress={() => setGymCategoryDraftSecondarySubs((prev) => {
                                const current = prev[tag] ?? [];
                                const next = current.includes(sub) ? current.filter((s) => s !== sub) : [...current, sub];
                                return { ...prev, [tag]: next };
                              })}
                              onLongPress={() => {
                                if (!gymCategoryEditorExerciseId) return;
                                const ex = gymLibraryExercises.find((e) => e.id === gymCategoryEditorExerciseId);
                                if (ex) removeGymTag(ex, sub);
                              }}
                            >
                              <Text style={[styles.chipText, styles.inlineSubChipText, subSel && styles.chipTextActive]}>{sub}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  ))}
                </View>
                <Text style={styles.categorySectionLabel}>Utrustning</Text>
                <View style={styles.categoryChipSection}>
                  <View style={styles.chipWrap}>
                    {GYM_EQUIPMENT_TAGS.map((tag) => (
                      <Pressable
                        key={`gym-equip-${tag}`}
                        style={[styles.chip, gymCategoryDraftEquipment.includes(tag) && styles.chipActive]}
                        onPress={() =>
                          setGymCategoryDraftEquipment((prev) =>
                            prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag],
                          )
                        }
                        onLongPress={() => {
                          if (!gymCategoryEditorExerciseId) return;
                          const ex = gymLibraryExercises.find((e) => e.id === gymCategoryEditorExerciseId);
                          if (ex) removeGymTag(ex, tag);
                        }}
                      >
                        <Text style={[styles.chipText, gymCategoryDraftEquipment.includes(tag) && styles.chipTextActive]}>{tag}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </ScrollView>
              <View style={styles.timePickerActions}>
                <Button onPress={closeGymCategoryEditor}>Avbryt</Button>
                <Button mode="contained" onPress={saveGymCategoryEditor}>Spara</Button>
              </View>
            </View>
          </View>
        )}

        <Modal visible={!!gymRemoveTagConfirm} transparent animationType="fade" onRequestClose={() => setGymRemoveTagConfirm(null)}>
          <View style={styles.timePickerBackdrop}>
            <View style={styles.timePickerCard}>
              <Text style={styles.timePickerTitle}>{gymRemoveTagConfirm?.canRemove ? 'Ta bort kategori' : 'Kategori låst'}</Text>
              <Text style={styles.confirmBody}>
                {gymRemoveTagConfirm?.canRemove
                  ? `"${gymRemoveTagConfirm.tag}" tas bort från alla övningar.${'\n'}Det går inte att ångra.`
                  : `"${gymRemoveTagConfirm?.tag ?? ''}" är en inbyggd kategori och kan inte tas bort permanent.`}
              </Text>
              <View style={styles.confirmActions}>
                <Button mode="outlined" textColor="#DCE4EC" onPress={() => setGymRemoveTagConfirm(null)}>
                  {gymRemoveTagConfirm?.canRemove ? 'Avbryt' : 'Stäng'}
                </Button>
                {gymRemoveTagConfirm?.canRemove && (
                  <Button mode="contained" buttonColor="#EF5350" textColor="#fff" onPress={confirmRemoveGymTag}>
                    Ta bort
                  </Button>
                )}
              </View>
            </View>
          </View>
        </Modal>
      </Portal>
    </View>
  );
}

function formatOutdoorDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const OUTDOOR_SPORT_META: Record<RunSport, { title: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; accent: string }> = {
  run: { title: 'Lopning', icon: 'run-fast', accent: '#43A047' },
  cycle: { title: 'Cykel', icon: 'bike-fast', accent: '#1E88E5' },
  walk: { title: 'Promenad', icon: 'walk', accent: '#FB8C00' },
};
const OUTDOOR_IDLE_FALLBACK_CENTER: [number, number] = [18.0686, 59.3293];

function RunMap({
  points,
  followUser,
  onUserGesture,
  verticalFocusOffsetPx,
  isSessionMode = false,
}: {
  points: RunPoint[];
  followUser: boolean;
  onUserGesture: () => void;
  verticalFocusOffsetPx?: number;
  isSessionMode?: boolean;
}) {
  const cameraRef = useRef<any>(null);
  const lastPoint = points[points.length - 1];
  const [idleCenter, setIdleCenter] = useState<[number, number]>(OUTDOOR_IDLE_FALLBACK_CENTER);
  const routeFeature = useMemo(() => toLineStringFeature(points), [points]);
  const applyVerticalFocusOffset = useCallback(
    (coord: [number, number], zoomLevel: number): [number, number] => {
      const offsetPx = verticalFocusOffsetPx ?? 0;
      if (offsetPx <= 0) return coord;
      const latitude = coord[1];
      const metersPerPixel = (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / Math.pow(2, zoomLevel);
      const latOffset = (metersPerPixel * offsetPx) / 111320;
      return [coord[0], coord[1] - latOffset];
    },
    [verticalFocusOffsetPx],
  );

  useEffect(() => {
    if (lastPoint) return;
    let mounted = true;
    (async () => {
      const existing = await Location.getForegroundPermissionsAsync();
      let granted = existing.granted;
      if (!granted && existing.status === 'undetermined') {
        const requested = await Location.requestForegroundPermissionsAsync();
        granted = requested.granted;
      }
      if (!granted) return;
      const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60 * 1000 });
      const position = lastKnown ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (!position || !mounted) return;
      setIdleCenter([position.coords.longitude, position.coords.latitude]);
    })().catch(() => {});
    return () => {
      mounted = false;
    };
  }, [lastPoint]);

  useEffect(() => {
    if (!followUser || !cameraRef.current?.setCamera) return;
    const baseCenterCoordinate: [number, number] = lastPoint ? [lastPoint.longitude, lastPoint.latitude] : idleCenter;
    const zoomLevel = isSessionMode ? 16 : (lastPoint ? 16 : 14);
    cameraRef.current.setCamera({
      centerCoordinate: applyVerticalFocusOffset(baseCenterCoordinate, zoomLevel),
      zoomLevel,
      animationDuration: 450,
    });
  }, [applyVerticalFocusOffset, followUser, idleCenter, isSessionMode, lastPoint]);

  const baseCenterCoordinate: [number, number] = lastPoint ? [lastPoint.longitude, lastPoint.latitude] : idleCenter;
  const zoomLevel = isSessionMode ? 16 : (lastPoint ? 16 : 14);
  const centerCoordinate = applyVerticalFocusOffset(baseCenterCoordinate, zoomLevel);

  return (
    <MapLibreGL.MapView
      style={StyleSheet.absoluteFillObject}
      mapStyle={OPEN_FREE_MAP_STYLE_URL}
      logoEnabled={false}
      compassEnabled
      onRegionWillChange={onUserGesture}
    >
      <MapLibreGL.Camera ref={cameraRef} zoomLevel={zoomLevel} centerCoordinate={centerCoordinate} />
      <MapLibreGL.UserLocation visible />
      {points.length > 1 ? (
        <MapLibreGL.ShapeSource id="runRouteSource" shape={routeFeature}>
          <MapLibreGL.LineLayer id="runRouteLine" style={{ lineColor: '#4FC3F7', lineWidth: 4, lineCap: 'round', lineJoin: 'round' }} />
        </MapLibreGL.ShapeSource>
      ) : null}
    </MapLibreGL.MapView>
  );
}

function OutdoorTrainingScreen({
  onActiveSessionChange,
  onRootViewChange,
  disableTopInset = false,
}: {
  onActiveSessionChange: (active: boolean) => void;
  onRootViewChange?: (isRoot: boolean) => void;
  disableTopInset?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const isCompactOutdoorScreen = windowHeight < 760 || windowWidth < 380;
  const [selectedSport, setSelectedSport] = useState<RunSport>('run');
  const [followUser, setFollowUser] = useState(true);
  const [openYears, setOpenYears] = useState<Record<string, boolean>>({});
  const [openMonthsByYear, setOpenMonthsByYear] = useState<Record<string, Record<string, boolean>>>({});
  const [historySelectionMode, setHistorySelectionMode] = useState(false);
  const [selectedHistoryRunIds, setSelectedHistoryRunIds] = useState<string[]>([]);
  const [deleteRunsConfirmVisible, setDeleteRunsConfirmVisible] = useState(false);
  const [isPrestartVisible, setIsPrestartVisible] = useState(false);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [prestartCount, setPrestartCount] = useState(3);
  const prestartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prestartTimeoutResolveRef = useRef<(() => void) | null>(null);
  const prestartCancelledRef = useRef(false);
  const prestartRunnerOffset = useRef(new Animated.Value(0)).current;
  const {
    activeRun,
    activePoints,
    activeStats,
    historyRuns,
    selectedHistoryRun,
    selectedHistoryPoints,
    loading,
    start,
    pause,
    resume,
    finish,
    openHistoryRun,
    clearHistorySelection,
    deleteHistoryRuns,
  } = useActiveRunSession();

  useEffect(() => {
    prestartCancelledRef.current = false;
    return () => {
      prestartCancelledRef.current = true;
      if (prestartTimeoutRef.current) {
        clearTimeout(prestartTimeoutRef.current);
        prestartTimeoutRef.current = null;
      }
      if (prestartTimeoutResolveRef.current) {
        prestartTimeoutResolveRef.current();
        prestartTimeoutResolveRef.current = null;
      }
    };
  }, []);

  const waitPrestartTick = useCallback(
    (ms: number): Promise<void> => new Promise((resolve) => {
      if (prestartTimeoutRef.current) {
        clearTimeout(prestartTimeoutRef.current);
      }
      prestartTimeoutResolveRef.current = resolve;
      prestartTimeoutRef.current = setTimeout(() => {
        prestartTimeoutRef.current = null;
        prestartTimeoutResolveRef.current = null;
        resolve();
      }, ms);
    }),
    [],
  );
  const cancelPrestart = useCallback(() => {
    prestartCancelledRef.current = true;
    if (prestartTimeoutRef.current) {
      clearTimeout(prestartTimeoutRef.current);
      prestartTimeoutRef.current = null;
    }
    if (prestartTimeoutResolveRef.current) {
      prestartTimeoutResolveRef.current();
      prestartTimeoutResolveRef.current = null;
    }
    setIsPrestartVisible(false);
    setPrestartCount(3);
    setIsStartingRun(false);
  }, []);
  const handleStartPress = useCallback(async () => {
    if (loading || isPrestartVisible || isStartingRun || !!activeRun) return;
    prestartCancelledRef.current = false;
    setIsStartingRun(true);
    setIsPrestartVisible(true);
    setPrestartCount(3);
    try {
      for (let remaining = 3; remaining >= 1; remaining -= 1) {
        if (prestartCancelledRef.current) return;
        setPrestartCount(remaining);
        await waitPrestartTick(1000);
      }
      if (prestartCancelledRef.current) return;
      // Countdown is done; start session so tracking/timer begins now.
      await start(selectedSport);
      if (prestartCancelledRef.current) return;
      setIsPrestartVisible(false);
    } finally {
      if (prestartTimeoutRef.current) {
        clearTimeout(prestartTimeoutRef.current);
        prestartTimeoutRef.current = null;
      }
      prestartTimeoutResolveRef.current = null;
      if (!prestartCancelledRef.current) {
        setIsPrestartVisible(false);
        setPrestartCount(3);
      }
      setIsStartingRun(false);
    }
  }, [activeRun, isPrestartVisible, isStartingRun, loading, selectedSport, start, waitPrestartTick]);

  useEffect(() => {
    if (!isPrestartVisible) {
      prestartRunnerOffset.stopAnimation();
      prestartRunnerOffset.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(prestartRunnerOffset, {
          toValue: 1,
          duration: 420,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(prestartRunnerOffset, {
          toValue: 0,
          duration: 420,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      prestartRunnerOffset.stopAnimation();
      prestartRunnerOffset.setValue(0);
    };
  }, [isPrestartVisible, prestartRunnerOffset]);

  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    onActiveSessionChange(!!activeRun);
  }, [activeRun, onActiveSessionChange]);

  useEffect(() => {
    const isRoot = !selectedHistoryRun && !activeRun;
    onRootViewChange?.(isRoot);
  }, [activeRun, onRootViewChange, selectedHistoryRun]);

  const durationSec = Math.floor((activeStats?.durationMs ?? 0) / 1000);
  const distanceKm = (activeStats?.distanceM ?? 0) / 1000;
  const currentPace = activeStats?.currentPaceSecPerKm ?? 0;
  const avgPace = activeStats?.avgPaceSecPerKm ?? 0;
  const isSessionActive = !!activeRun;
  const isStartOverlayVisible = isPrestartVisible || isStartingRun;
  const isSessionVisualActive = isSessionActive || isPrestartVisible || isStartingRun;
  const sessionTransition = useRef(new Animated.Value(isSessionVisualActive ? 1 : 0)).current;
  const previousSessionStateRef = useRef(isSessionVisualActive);
  const compactMapHeight = 210;
  const expandedMapHeight = Math.max(
    isCompactOutdoorScreen ? 340 : 410,
    Math.round(windowHeight * (isCompactOutdoorScreen ? 0.6 : 0.7)),
  );
  const animatedMapHeight = sessionTransition.interpolate({
    inputRange: [0, 1],
    outputRange: [compactMapHeight, expandedMapHeight],
  });
  const activeSectionOpacity = sessionTransition.interpolate({
    inputRange: [0, 0.2, 1],
    outputRange: [0, 0, 1],
  });
  const activeSectionTranslateY = sessionTransition.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0],
  });
  const historyBounds = getRouteBounds(selectedHistoryPoints);
  const historyCameraRef = useRef<any>(null);
  const monthLabelFormatter = useMemo(() => new Intl.DateTimeFormat('sv-SE', { month: 'long' }), []);
  const groupedHistory = useMemo(() => {
    const years = new Map<number, Map<number, RunRecord[]>>();
    historyRuns.forEach((run) => {
      const date = new Date(run.startedAt);
      const year = date.getFullYear();
      const month = date.getMonth();
      if (!years.has(year)) years.set(year, new Map<number, RunRecord[]>());
      const months = years.get(year)!;
      if (!months.has(month)) months.set(month, []);
      months.get(month)!.push(run);
    });
    return Array.from(years.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([year, months]) => ({
        year,
        runCount: Array.from(months.values()).reduce((sum, runs) => sum + runs.length, 0),
        months: Array.from(months.entries())
          .sort((a, b) => b[0] - a[0])
          .map(([monthIndex, runs]) => ({
            monthKey: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
            monthLabel: monthLabelFormatter.format(new Date(year, monthIndex, 1)),
            runs,
          })),
      }));
  }, [historyRuns, monthLabelFormatter]);

  const toggleYear = useCallback((yearKey: string) => {
    setOpenYears((prev) => {
      const isOpen = !!prev[yearKey];
      if (!isOpen) return { ...prev, [yearKey]: true };
      const next = { ...prev };
      delete next[yearKey];
      return next;
    });
    setOpenMonthsByYear((prev) => {
      if (!prev[yearKey]) return prev;
      const next = { ...prev };
      delete next[yearKey];
      return next;
    });
  }, []);

  const toggleMonth = useCallback((yearKey: string, monthKey: string) => {
    setOpenMonthsByYear((prev) => {
      const yearMonths = prev[yearKey] ?? {};
      const isOpen = !!yearMonths[monthKey];
      if (!isOpen) {
        return {
          ...prev,
          [yearKey]: { ...yearMonths, [monthKey]: true },
        };
      }
      const nextYearMonths = { ...yearMonths };
      delete nextYearMonths[monthKey];
      if (Object.keys(nextYearMonths).length === 0) {
        const next = { ...prev };
        delete next[yearKey];
        return next;
      }
      return {
        ...prev,
        [yearKey]: nextYearMonths,
      };
    });
  }, []);

  useEffect(() => {
    setSelectedHistoryRunIds((prev) => {
      if (prev.length === 0) return prev;
      const validIds = new Set(historyRuns.map((run) => run.id));
      const next = prev.filter((id) => validIds.has(id));
      if (next.length === 0 && historySelectionMode) {
        setHistorySelectionMode(false);
      }
      return next.length === prev.length ? prev : next;
    });
  }, [historyRuns, historySelectionMode]);

  const activateHistorySelection = useCallback((runId: string) => {
    setHistorySelectionMode(true);
    setSelectedHistoryRunIds((prev) => (prev.includes(runId) ? prev : [...prev, runId]));
  }, []);

  const toggleHistorySelection = useCallback((runId: string) => {
    setSelectedHistoryRunIds((prev) => {
      const next = prev.includes(runId) ? prev.filter((id) => id !== runId) : [...prev, runId];
      if (next.length === 0) setHistorySelectionMode(false);
      return next;
    });
  }, []);

  const deleteSelectedHistoryRuns = useCallback(async () => {
    if (selectedHistoryRunIds.length === 0) return;
    await deleteHistoryRuns(selectedHistoryRunIds);
    setSelectedHistoryRunIds([]);
    setHistorySelectionMode(false);
  }, [deleteHistoryRuns, selectedHistoryRunIds]);

  useEffect(() => {
    if (selectedHistoryPoints.length < 2 || !historyBounds || !historyCameraRef.current?.fitBounds) return;
    historyCameraRef.current.fitBounds(historyBounds[0], historyBounds[1], 80, 500);
  }, [historyBounds, selectedHistoryPoints.length]);

  useEffect(() => {
    const wasSessionActive = previousSessionStateRef.current;
    if (wasSessionActive !== isSessionVisualActive) {
      LayoutAnimation.configureNext({
        duration: 360,
        update: {
          type: LayoutAnimation.Types.easeInEaseOut,
          property: LayoutAnimation.Properties.opacity,
        },
        create: {
          type: LayoutAnimation.Types.easeInEaseOut,
          property: LayoutAnimation.Properties.opacity,
        },
        delete: {
          type: LayoutAnimation.Types.easeInEaseOut,
          property: LayoutAnimation.Properties.opacity,
        },
      });
    }
    previousSessionStateRef.current = isSessionVisualActive;
    Animated.timing(sessionTransition, {
      toValue: isSessionVisualActive ? 1 : 0,
      duration: 380,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [isSessionVisualActive, sessionTransition]);

  if (selectedHistoryRun) {
    return (
      <View style={[styles.screen, { paddingTop: disableTopInset ? 0 : insets.top }]}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.outdoorDetailScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.trainingSessionTop}>
            <View style={styles.trainingSessionTopRow}>
              <Pressable style={styles.trainingMiniButton} onPress={clearHistorySelection}>
                <MaterialIcons name="arrow-back" size={20} color="#DCE4EC" />
              </Pressable>
              <Text style={styles.trainingTimer}>Runddetalj</Text>
              <View style={styles.trainingTopActionsRight} />
            </View>
          </View>
          <View style={styles.outdoorMapCard}>
            <MapLibreGL.MapView style={StyleSheet.absoluteFillObject} mapStyle={OPEN_FREE_MAP_STYLE_URL} logoEnabled={false}>
              <MapLibreGL.Camera ref={historyCameraRef} zoomLevel={13} />
              {selectedHistoryPoints.length > 1 ? (
                <MapLibreGL.ShapeSource id="historyRouteSource" shape={toLineStringFeature(selectedHistoryPoints)}>
                  <MapLibreGL.LineLayer id="historyRouteLine" style={{ lineColor: '#4FC3F7', lineWidth: 4, lineCap: 'round', lineJoin: 'round' }} />
                </MapLibreGL.ShapeSource>
              ) : null}
            </MapLibreGL.MapView>
            {selectedHistoryPoints.length < 2 ? (
              <View style={styles.outdoorMapLoading}>
                <Text style={styles.outdoorMapLoadingText}>Ingen komplett ruttdata sparad</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.outdoorStatsGrid}>
            <View style={styles.outdoorStatCard}>
              <Text style={styles.outdoorStatLabel}>Datum</Text>
              <Text style={styles.outdoorStatValue}>
                {new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(selectedHistoryRun.startedAt))}
              </Text>
            </View>
            <View style={styles.outdoorStatCard}>
              <Text style={styles.outdoorStatLabel}>Distans</Text>
              <Text style={styles.outdoorStatValue}>{(selectedHistoryRun.totalDistanceM / 1000).toFixed(2)} km</Text>
            </View>
            <View style={styles.outdoorStatCard}>
              <Text style={styles.outdoorStatLabel}>Tid</Text>
              <Text style={styles.outdoorStatValue}>{formatOutdoorDuration(Math.floor(selectedHistoryRun.durationMs / 1000))}</Text>
            </View>
            <View style={styles.outdoorStatCard}>
              <Text style={styles.outdoorStatLabel}>Snittempo</Text>
              <Text style={styles.outdoorStatValue}>{selectedHistoryRun.avgPace > 0 ? `${formatOutdoorDuration(Math.round(selectedHistoryRun.avgPace))}/km` : '--:--/km'}</Text>
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: disableTopInset ? 0 : insets.top }]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.outdoorScrollContent,
          isSessionVisualActive && styles.outdoorScrollContentActive,
          { paddingBottom: (isSessionVisualActive ? 24 : 120) + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {!isSessionVisualActive ? (
          <View style={styles.outdoorSportRow}>
            {(Object.keys(OUTDOOR_SPORT_META) as RunSport[]).map((sport) => {
              const selected = selectedSport === sport;
              return (
                <Pressable
                  key={sport}
                  style={[styles.outdoorSportChip, selected && styles.outdoorSportChipActive]}
                  disabled={!!activeRun}
                  onPress={() => setSelectedSport(sport)}
                >
                  <MaterialCommunityIcons name={OUTDOOR_SPORT_META[sport].icon} size={16} color={selected ? '#D7ECFF' : '#9CB0C1'} />
                  <Text style={[styles.outdoorSportChipText, selected && styles.outdoorSportChipTextActive]}>{OUTDOOR_SPORT_META[sport].title}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <Animated.View style={[styles.outdoorMapCard, isSessionVisualActive && styles.outdoorMapCardActive, { height: animatedMapHeight }]}>
          <RunMap
            points={activePoints}
            followUser={followUser}
            onUserGesture={() => setFollowUser(false)}
            verticalFocusOffsetPx={isSessionVisualActive ? (isCompactOutdoorScreen ? 70 : 95) : 0}
            isSessionMode={isSessionVisualActive}
          />
          {isStartOverlayVisible ? (
            <View style={styles.prestartOverlay} pointerEvents="auto">
              <BlurView intensity={36} tint="dark" style={styles.prestartBlur} />
              <View style={styles.prestartContent}>
                <Animated.View
                  style={[
                    styles.prestartRunnerWrap,
                    {
                      transform: [{
                        translateX: prestartRunnerOffset.interpolate({
                          inputRange: [0, 1],
                          outputRange: [-8, 8],
                        }),
                      }],
                    },
                  ]}
                >
                  <MaterialCommunityIcons name="run-fast" size={36} color="#E4F3FF" style={styles.prestartIcon} />
                </Animated.View>
                <Text style={styles.prestartCountText}>{prestartCount}</Text>
                <Text style={styles.prestartHintText}>Gor dig redo...</Text>
              </View>
            </View>
          ) : null}
          {!followUser ? (
            <Pressable style={styles.outdoorMapLoading} onPress={() => setFollowUser(true)}>
              <Text style={styles.outdoorMapLoadingText}>Centrera</Text>
            </Pressable>
          ) : null}
          {isSessionVisualActive ? (
            <>
              <Animated.View
                style={[
                  styles.outdoorMapStatsOverlay,
                  {
                    opacity: activeSectionOpacity,
                    transform: [{ translateY: activeSectionTranslateY }],
                  },
                ]}
              >
                <View
                  style={[
                    styles.outdoorStatsGrid,
                    styles.outdoorStatsGridOverlay,
                    !isCompactOutdoorScreen && styles.outdoorStatsGridOverlayWide,
                  ]}
                >
                  <View style={[styles.outdoorStatCard, styles.outdoorStatCardOverlay, !isCompactOutdoorScreen && styles.outdoorStatCardOverlayWide]}>
                    <Text style={styles.outdoorStatLabel}>Tid</Text>
                    <Text style={styles.outdoorStatValue}>{formatOutdoorDuration(durationSec)}</Text>
                  </View>
                  <View style={[styles.outdoorStatCard, styles.outdoorStatCardOverlay, !isCompactOutdoorScreen && styles.outdoorStatCardOverlayWide]}>
                    <Text style={styles.outdoorStatLabel}>Distans</Text>
                    <Text style={styles.outdoorStatValue}>{distanceKm.toFixed(2)} km</Text>
                  </View>
                  <View style={[styles.outdoorStatCard, styles.outdoorStatCardOverlay, !isCompactOutdoorScreen && styles.outdoorStatCardOverlayWide]}>
                    <Text style={styles.outdoorStatLabel}>Tempo</Text>
                    <Text style={styles.outdoorStatValue}>{currentPace > 0 ? `${formatOutdoorDuration(Math.round(currentPace))}/km` : '--:--/km'}</Text>
                  </View>
                  <View style={[styles.outdoorStatCard, styles.outdoorStatCardOverlay, !isCompactOutdoorScreen && styles.outdoorStatCardOverlayWide]}>
                    <Text style={styles.outdoorStatLabel}>Snittempo</Text>
                    <Text style={styles.outdoorStatValue}>{avgPace > 0 ? `${formatOutdoorDuration(Math.round(avgPace))}/km` : '--:--/km'}</Text>
                  </View>
                </View>
              </Animated.View>
              <Animated.View
                style={[
                  styles.outdoorMapControlsOverlay,
                  {
                    opacity: activeSectionOpacity,
                    transform: [{ translateY: activeSectionTranslateY }],
                  },
                ]}
              >
                {isStartOverlayVisible ? (
                  <View style={styles.trainingHomeCardRow}>
                    <Pressable style={[styles.outdoorActionButton, styles.outdoorActionButtonHalf, { opacity: 0.55 }]} disabled>
                      <Text style={styles.outdoorActionButtonText}>Pausa</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.outdoorActionButton, styles.outdoorActionButtonStop, styles.outdoorActionButtonHalf]}
                      onPress={cancelPrestart}
                    >
                      <Text style={styles.outdoorActionButtonText}>Avbryt</Text>
                    </Pressable>
                  </View>
                ) : activeRun?.status === 'active' ? (
                  <View style={styles.trainingHomeCardRow}>
                    <Pressable style={[styles.outdoorActionButton, styles.outdoorActionButtonHalf]} onPress={pause}>
                      <Text style={styles.outdoorActionButtonText}>Pausa</Text>
                    </Pressable>
                    <Pressable style={[styles.outdoorActionButton, styles.outdoorActionButtonStop, styles.outdoorActionButtonHalf]} onPress={finish}>
                      <Text style={styles.outdoorActionButtonText}>Avbryt</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.trainingHomeCardRow}>
                    <Pressable style={[styles.outdoorActionButton, styles.outdoorActionButtonHalf]} onPress={resume}>
                      <Text style={styles.outdoorActionButtonText}>Ateruppta</Text>
                    </Pressable>
                    <Pressable style={[styles.outdoorActionButton, styles.outdoorActionButtonStop, styles.outdoorActionButtonHalf]} onPress={finish}>
                      <Text style={styles.outdoorActionButtonText}>Avbryt</Text>
                    </Pressable>
                  </View>
                )}
              </Animated.View>
            </>
          ) : null}
        </Animated.View>
        {!isSessionVisualActive ? (
          <>
            <View style={styles.outdoorActionRow}>
              <Pressable
                style={[styles.outdoorActionButton, { backgroundColor: OUTDOOR_SPORT_META[selectedSport].accent }]}
                onPress={handleStartPress}
                disabled={loading || isPrestartVisible || isStartingRun}
              >
                <Text style={styles.outdoorActionButtonText}>Starta runda</Text>
              </Pressable>
            </View>
            <View style={styles.outdoorHistoryWrap}>
              <View style={styles.historyHeaderRow}>
                <Text style={styles.trainingSectionTitle}>Tidigare rundor</Text>
                {historySelectionMode ? (
                  <View style={styles.historySelectionActions}>
                    <Text style={styles.historySelectedCount}>{selectedHistoryRunIds.length}</Text>
                    <Pressable style={styles.historyTrashButton} onPress={() => setDeleteRunsConfirmVisible(true)}>
                      <MaterialIcons name="delete" size={22} color="#0F1419" />
                    </Pressable>
                  </View>
                ) : null}
              </View>
              <View style={styles.outdoorHistoryList}>
                {historyRuns.length === 0 ? <Text style={styles.loggedSetEmpty}>Inga sparade rundor an.</Text> : null}
                {groupedHistory.map((yearGroup) => {
                  const yearKey = String(yearGroup.year);
                  const isYearOpen = !!openYears[yearKey];
                  return (
                    <View key={yearKey} style={styles.outdoorHistorySection}>
                      <Pressable style={styles.trainingCard} onPress={() => toggleYear(yearKey)}>
                        <View style={styles.outdoorHistoryHeaderRow}>
                          <View style={styles.outdoorHistoryHeaderTextWrap}>
                            <Text style={styles.trainingTitle}>{yearGroup.year}</Text>
                            <Text style={styles.trainingMeta}>{yearGroup.runCount} pass</Text>
                          </View>
                          <MaterialIcons name={isYearOpen ? 'expand-more' : 'chevron-right'} size={22} color="#DCE4EC" />
                        </View>
                      </Pressable>
                      {isYearOpen ? (
                        <View style={styles.outdoorHistoryMonthsList}>
                          {yearGroup.months.map((monthGroup) => {
                            const isMonthOpen = !!openMonthsByYear[yearKey]?.[monthGroup.monthKey];
                            return (
                              <View key={monthGroup.monthKey} style={styles.outdoorHistorySection}>
                                <Pressable style={[styles.trainingCard, styles.outdoorHistoryMonthCard]} onPress={() => toggleMonth(yearKey, monthGroup.monthKey)}>
                                  <View style={styles.outdoorHistoryHeaderRow}>
                                    <View style={styles.outdoorHistoryHeaderTextWrap}>
                                      <Text style={styles.trainingTitle}>{monthGroup.monthLabel}</Text>
                                      <Text style={styles.trainingMeta}>{monthGroup.runs.length} pass</Text>
                                    </View>
                                    <MaterialIcons name={isMonthOpen ? 'expand-more' : 'chevron-right'} size={22} color="#DCE4EC" />
                                  </View>
                                </Pressable>
                                {isMonthOpen ? (
                                  <View style={styles.outdoorHistoryRunsList}>
                                    {monthGroup.runs.map((run) => (
                                      <Pressable
                                        key={run.id}
                                        style={[
                                          styles.trainingCard,
                                          styles.outdoorHistoryRunCard,
                                          selectedHistoryRunIds.includes(run.id) && styles.historySelectedCard,
                                        ]}
                                        onLongPress={() => activateHistorySelection(run.id)}
                                        onPress={() => {
                                          if (historySelectionMode) {
                                            toggleHistorySelection(run.id);
                                            return;
                                          }
                                          openHistoryRun(run);
                                        }}
                                      >
                                        <Text style={styles.trainingTitle}>{OUTDOOR_SPORT_META[run.sport as RunSport]?.title ?? 'Runda'}</Text>
                                        <Text style={styles.trainingMeta}>
                                          {new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(run.startedAt))}
                                        </Text>
                                        <Text style={styles.trainingMeta}>
                                          {(run.totalDistanceM / 1000).toFixed(2)} km • {formatOutdoorDuration(Math.floor(run.durationMs / 1000))} • {run.avgPace > 0 ? `${formatOutdoorDuration(Math.round(run.avgPace))}/km` : '--:--/km'}
                                        </Text>
                                      </Pressable>
                                    ))}
                                  </View>
                                ) : null}
                              </View>
                            );
                          })}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>

      <Modal visible={deleteRunsConfirmVisible} transparent animationType="fade" onRequestClose={() => setDeleteRunsConfirmVisible(false)}>
        <View style={styles.timePickerBackdrop}>
          <View style={styles.timePickerCard}>
            <Text style={styles.timePickerTitle}>Ta bort rundor?</Text>
            <Text style={styles.confirmBody}>
              Vill du ta bort {selectedHistoryRunIds.length} {selectedHistoryRunIds.length === 1 ? 'runda' : 'rundor'} från historiken?{'\n'}Det går inte att ångra.
            </Text>
            <View style={styles.confirmActions}>
              <Button mode="outlined" textColor="#DCE4EC" onPress={() => setDeleteRunsConfirmVisible(false)}>
                Avbryt
              </Button>
              <Button mode="contained" buttonColor="#EF5350" textColor="#fff" onPress={() => { setDeleteRunsConfirmVisible(false); deleteSelectedHistoryRuns(); }}>
                Ta bort
              </Button>
            </View>
          </View>
        </View>
      </Modal>
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
  gymCustomMuscleGroups,
  setGymCustomMuscleGroups,
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
  gymCustomMuscleGroups: string[];
  setGymCustomMuscleGroups: React.Dispatch<React.SetStateAction<string[]>>;
  onFabActionChange: (action: (() => void) | null) => void;
  onActiveSessionChange: (active: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const [pageIndex, setPageIndex] = useState(0);
  const [gymFabAction, setGymFabAction] = useState<(() => void) | null>(null);
  const [gymHasActiveSession, setGymHasActiveSession] = useState(false);
  const [outdoorHasActiveSession, setOutdoorHasActiveSession] = useState(false);
  const [gymRootVisible, setGymRootVisible] = useState(true);
  const [outdoorRootVisible, setOutdoorRootVisible] = useState(true);
  const [topSwitchHeight, setTopSwitchHeight] = useState(0);
  const pageAnim = useRef(new Animated.Value(1)).current;
  const previousPageIndexRef = useRef(0);
  const isInitialMountRef = useRef(true);
  const handleGymFabActionChange = useCallback((action: (() => void) | null) => {
    setGymFabAction((prev) => {
      if (prev === action) return prev;
      return action;
    });
  }, []);

  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    pageAnim.setValue(0);
    Animated.timing(pageAnim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [pageAnim, pageIndex]);

  useEffect(() => {
    onFabActionChange(pageIndex === 0 ? gymFabAction : null);
  }, [gymFabAction, onFabActionChange, pageIndex]);

  useEffect(() => {
    onActiveSessionChange(gymHasActiveSession || outdoorHasActiveSession);
  }, [gymHasActiveSession, onActiveSessionChange, outdoorHasActiveSession]);

  const changePage = useCallback((nextPage: number) => {
    previousPageIndexRef.current = pageIndex;
    setPageIndex(nextPage);
  }, [pageIndex]);

  const animationDirection = pageIndex >= previousPageIndexRef.current ? 1 : -1;
  const pageTranslateX = pageAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [18 * animationDirection, 0],
  });
  const pageOpacity = pageAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.65, 1],
  });
  const showTopSwitch = pageIndex === 0 ? gymRootVisible : outdoorRootVisible;
  const pagerTopOffset = showTopSwitch ? 0 : -(topSwitchHeight + 2);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.trainingPageHeader}>
        <Text style={styles.screenTitle}>Träning</Text>
      </View>
      <View
        style={styles.trainingPageToggleWrap}
        pointerEvents={showTopSwitch ? 'auto' : 'none'}
        onLayout={(event) => {
          const measuredHeight = Math.round(event.nativeEvent.layout.height);
          setTopSwitchHeight((prev) => (prev === measuredHeight ? prev : measuredHeight));
        }}
      >
        <Pressable
          style={[styles.trainingPageToggleChip, pageIndex === 0 && styles.trainingPageToggleChipActive]}
          onPress={() => changePage(0)}
        >
          <MaterialCommunityIcons name="dumbbell" size={16} color={pageIndex === 0 ? '#D7ECFF' : '#9CB0C1'} />
          <Text style={[styles.trainingPageToggleText, pageIndex === 0 && styles.trainingPageToggleTextActive]}>Gym/Styrka</Text>
        </Pressable>
        <Pressable
          style={[styles.trainingPageToggleChip, pageIndex === 1 && styles.trainingPageToggleChipActive]}
          onPress={() => changePage(1)}
        >
          <MaterialCommunityIcons name="run-fast" size={16} color={pageIndex === 1 ? '#D7ECFF' : '#9CB0C1'} />
          <Text style={[styles.trainingPageToggleText, pageIndex === 1 && styles.trainingPageToggleTextActive]}>Lop/Cykel/Promenad</Text>
        </Pressable>
      </View>
      <View style={[styles.trainingPagerViewport, { marginTop: pagerTopOffset }]}>
        <Animated.View style={{ flex: 1, opacity: pageOpacity, transform: [{ translateX: pageTranslateX }] }}>
          {pageIndex === 0 ? (
            <GymTrainingScreen
              workoutPlans={workoutPlans}
              setWorkoutPlans={setWorkoutPlans}
              completedWorkouts={completedWorkouts}
              setCompletedWorkouts={setCompletedWorkouts}
              exerciseWeightPbs={exerciseWeightPbs}
              setExerciseWeightPbs={setExerciseWeightPbs}
              gymLibraryExercises={gymLibraryExercises}
              setGymLibraryExercises={setGymLibraryExercises}
              gymCustomMuscleGroups={gymCustomMuscleGroups}
              setGymCustomMuscleGroups={setGymCustomMuscleGroups}
              showHomeTitle={false}
              disableTopInset
              onFabActionChange={handleGymFabActionChange}
              onActiveSessionChange={setGymHasActiveSession}
              onRootViewChange={setGymRootVisible}
            />
          ) : (
            <OutdoorTrainingScreen
              onActiveSessionChange={setOutdoorHasActiveSession}
              onRootViewChange={setOutdoorRootVisible}
              disableTopInset
            />
          )}
        </Animated.View>
      </View>
    </View>
  );
}

type AnalysisType = 'rehabFrequency' | 'exerciseProgression' | 'muscleGroupBars' | 'distributionPie';
type ProgressScope = 'exercise' | 'primaryMuscle';
type ProgressMetric = 'topset' | 'volume';
type ProgressGranularity = 'day' | 'week' | 'month';
type ProgressTimeRange = '2w' | '2m' | '6m' | 'all';
type MuscleMetric = 'sets' | 'volume';
type DistributionMetric = 'sets' | 'volume';
type DistributionScope = 'primary' | 'secondary' | 'both';
type DistributionGranularity = 'group' | 'detail';
type WeeklyBucket = { key: string; start: Date; end: Date; label: string; headerLabel: string };
type ProgressionOption = { key: string; label: string };
type ProgressionScopeOption = { key: string; label: string };
type ProgressionChartPoint = { x: number; y: number; value: number; bucketKey: string; dateMs: number; renderKey?: string; opacity?: number };
type ProgressionScoreRow = {
  weekKey: string;
  endedAtIso: string;
  exerciseKey: string;
  primaryMuscleTag: string;
  topsetScore: number;
  volumeScore: number;
  topsetIndex: number | null;
  volumeIndex: number | null;
};
type ProgressionWorkoutRow = {
  weekKey: string;
  endedAtIso: string;
  exerciseKey: string;
  primaryMuscleTag: string;
  setScores: { reps: number; score: number }[];
};
type PieSlice = { label: string; value: number; color: string };
type HierarchySlice = { label: string; value: number; color: string; children: { label: string; value: number; pct: number; color: string }[] };
type AnalysisBlock = {
  id: string;
  type: AnalysisType;
  exerciseKey?: string;
  primaryMuscleTag?: string;
  progressScope?: ProgressScope;
  progressMetric?: ProgressMetric;
  progressGranularity?: ProgressGranularity;
  progressTimeRange?: ProgressTimeRange;
  repMin?: number;
  repMax?: number;
  weightMin?: number;
  weightMax?: number;
  lookbackWeeks?: number;
  muscleGroupTag?: string;
  muscleMetric?: MuscleMetric;
  distributionMetric?: DistributionMetric;
  distributionScope?: DistributionScope;
  distributionGranularity?: DistributionGranularity;
};

const WEEK_WIDTH = 64;
const DAY_MS = 24 * 60 * 60 * 1000;
const PROGRESSION_TIMELINE_SIDE_PADDING = WEEK_WIDTH / 2;
const PROGRESSION_GRID_INTERVAL_MS = 7 * DAY_MS;
const PROGRESSION_MORPH_FRAME_MS = 16;
const PROGRESSION_MORPH_MAX_POINTS = 52;
const NON_MUSCLE_TAGS = new Set(['Maskin', 'Fria vikter', 'Kabel', 'Kroppsvikt', 'Egen']);
const DEFAULT_REP_MIN = 1;
const DEFAULT_REP_MAX = 50;
const DEFAULT_WEIGHT_MIN = 0;
const DEFAULT_WEIGHT_MAX = 400;
const DEFAULT_LOOKBACK_WEEKS = 14;
const DEFAULT_PROGRESS_GRANULARITY: ProgressGranularity = 'week';
const DEFAULT_PROGRESS_TIME_RANGE: ProgressTimeRange = '2m';
const MIN_LOOKBACK_WEEKS = 4;
const MAX_LOOKBACK_WEEKS = 104;
const BRZYCKI_REFERENCE_MIN_SESSIONS = 1;
const BRZYCKI_REFERENCE_MAX_SESSIONS = 7;
const PROGRESSION_STRENGTH_COLOR = '#90CAF9';
const PROGRESSION_VOLUME_COLOR = '#C8E57A';

const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress;

const nearestProgressionPoint = (points: ProgressionChartPoint[], target: ProgressionChartPoint) => {
  if (points.length === 0) return target;
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].dateMs < target.dateMs) low = mid + 1;
    else high = mid;
  }
  const after = points[low];
  const before = points[Math.max(0, low - 1)];
  return Math.abs(before.dateMs - target.dateMs) <= Math.abs(after.dateMs - target.dateMs)
    ? before
    : after;
};

const interpolateProgressionPoints = (
  sourcePoints: ProgressionChartPoint[],
  targetPoints: ProgressionChartPoint[],
  progress: number,
): ProgressionChartPoint[] => (
  targetPoints.map((target) => {
    const source = nearestProgressionPoint(sourcePoints, target);
    return {
      ...target,
      x: lerp(source.x, target.x, progress),
      y: lerp(source.y, target.y, progress),
    };
  })
);

const progressionPointIdentity = (point: ProgressionChartPoint) => `${point.bucketKey}-${point.dateMs}`;

const interpolateProgressionPointMarkers = (
  sourcePoints: ProgressionChartPoint[],
  targetPoints: ProgressionChartPoint[],
  progress: number,
): ProgressionChartPoint[] => {
  const targetMarkers = interpolateProgressionPoints(sourcePoints, targetPoints, progress).map((point) => ({
    ...point,
    renderKey: `target-${point.bucketKey}`,
    opacity: sourcePoints.length === 0 ? progress : 1,
  }));
  if (sourcePoints.length <= targetPoints.length) return targetMarkers;

  const consumedSourceIds = new Set<string>();
  targetPoints.forEach((target) => {
    consumedSourceIds.add(progressionPointIdentity(nearestProgressionPoint(sourcePoints, target)));
  });

  const mergingMarkers = sourcePoints
    .filter((source) => !consumedSourceIds.has(progressionPointIdentity(source)))
    .map((source) => {
      const target = nearestProgressionPoint(targetPoints, source);
      return {
        ...source,
        renderKey: `merge-${source.bucketKey}-${target.bucketKey}`,
        x: lerp(source.x, target.x, progress),
        y: lerp(source.y, target.y, progress),
        opacity: 1 - progress,
      };
    });

  return [...targetMarkers, ...mergingMarkers].sort((a, b) => a.x - b.x);
};

const progressionPointSignature = (points: ProgressionChartPoint[]) => (
  points.map((point) => `${point.bucketKey}:${Math.round(point.x)}:${Math.round(point.y)}:${point.dateMs}`).join('|')
);

const sampleProgressionPointsForMorph = (points: ProgressionChartPoint[]) => {
  if (points.length <= PROGRESSION_MORPH_MAX_POINTS) return points;
  const sampled: ProgressionChartPoint[] = [];
  let previousIndex = -1;
  for (let i = 0; i < PROGRESSION_MORPH_MAX_POINTS; i += 1) {
    const index = Math.round((i / (PROGRESSION_MORPH_MAX_POINTS - 1)) * (points.length - 1));
    if (index !== previousIndex) sampled.push(points[index]);
    previousIndex = index;
  }
  return sampled;
};

const ProgressionLineChart = React.memo(function ProgressionLineChart({
  animateKey,
  baselineY,
  blockId,
  chartCanvasWidth,
  gridLines,
  lineChartHeight,
  strengthPoints,
  volumePoints,
}: {
  animateKey: string;
  baselineY: number;
  blockId: string;
  chartCanvasWidth: number;
  gridLines: { key: string; x: number }[];
  lineChartHeight: number;
  strengthPoints: ProgressionChartPoint[];
  volumePoints: ProgressionChartPoint[];
}) {
  const frameRef = useRef<number | null>(null);
  const previousAnimateKeyRef = useRef(animateKey);
  const previousSignatureRef = useRef('');
  const morphSourceRef = useRef<{ strength: ProgressionChartPoint[]; volume: ProgressionChartPoint[] } | null>(null);
  const morphTargetRef = useRef<{ strength: ProgressionChartPoint[]; volume: ProgressionChartPoint[] } | null>(null);
  const renderedPointsRef = useRef<{ strength: ProgressionChartPoint[]; volume: ProgressionChartPoint[] }>({
    strength: strengthPoints,
    volume: volumePoints,
  });
  const [morphProgress, setMorphProgress] = useState(1);
  const targetSignature = `${progressionPointSignature(strengthPoints)}::${progressionPointSignature(volumePoints)}`;

  useLayoutEffect(() => {
    if (previousSignatureRef.current === '') {
      previousSignatureRef.current = targetSignature;
      previousAnimateKeyRef.current = animateKey;
      renderedPointsRef.current = { strength: strengthPoints, volume: volumePoints };
      return;
    }

    if (previousSignatureRef.current === targetSignature) return;

    const shouldAnimate = previousAnimateKeyRef.current !== animateKey;
    previousSignatureRef.current = targetSignature;
    previousAnimateKeyRef.current = animateKey;

    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;

    if (!shouldAnimate) {
      morphSourceRef.current = null;
      morphTargetRef.current = null;
      renderedPointsRef.current = { strength: strengthPoints, volume: volumePoints };
      setMorphProgress(1);
      return;
    }

    morphSourceRef.current = {
      strength: sampleProgressionPointsForMorph(renderedPointsRef.current.strength.length > 0 ? renderedPointsRef.current.strength : strengthPoints),
      volume: sampleProgressionPointsForMorph(renderedPointsRef.current.volume.length > 0 ? renderedPointsRef.current.volume : volumePoints),
    };
    morphTargetRef.current = {
      strength: sampleProgressionPointsForMorph(strengthPoints),
      volume: sampleProgressionPointsForMorph(volumePoints),
    };
    setMorphProgress(0);

    const durationMs = 360;
    let startedAt: number | undefined;
    let lastUpdateAt = 0;
    const tick = (timestamp: number) => {
      if (startedAt === undefined) startedAt = timestamp;
      const rawProgress = Math.min(1, (timestamp - startedAt) / durationMs);
      const easedProgress = 1 - Math.pow(1 - rawProgress, 3);
      if (rawProgress >= 1 || timestamp - lastUpdateAt >= PROGRESSION_MORPH_FRAME_MS) {
        lastUpdateAt = timestamp;
        setMorphProgress(Math.round(easedProgress * 1000) / 1000);
      }
      if (rawProgress < 1) {
        frameRef.current = requestAnimationFrame(tick);
        return;
      }
      frameRef.current = null;
      morphSourceRef.current = null;
      morphTargetRef.current = null;
      renderedPointsRef.current = { strength: strengthPoints, volume: volumePoints };
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [animateKey, strengthPoints, targetSignature, volumePoints]);

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
  }, []);

  const morphSource = morphSourceRef.current;
  const morphTarget = morphTargetRef.current;
  const targetStrengthPoints = morphSource && morphTarget ? morphTarget.strength : strengthPoints;
  const targetVolumePoints = morphSource && morphTarget ? morphTarget.volume : volumePoints;
  const displayedStrengthLinePoints = morphSource
    ? interpolateProgressionPoints(morphSource.strength, targetStrengthPoints, morphProgress)
    : targetStrengthPoints;
  const displayedVolumeLinePoints = morphSource
    ? interpolateProgressionPoints(morphSource.volume, targetVolumePoints, morphProgress)
    : targetVolumePoints;
  const displayedStrengthPointMarkers = morphSource
    ? interpolateProgressionPointMarkers(morphSource.strength, targetStrengthPoints, morphProgress)
    : targetStrengthPoints;
  const displayedVolumePointMarkers = morphSource
    ? interpolateProgressionPointMarkers(morphSource.volume, targetVolumePoints, morphProgress)
    : targetVolumePoints;

  return (
    <>
      <Svg width={chartCanvasWidth} height={lineChartHeight}>
        {gridLines.map((line) => (
          <Line
            key={`${line.key}-grid`}
            x1={line.x}
            y1={0}
            x2={line.x}
            y2={lineChartHeight - 30}
            stroke="#22313D"
          />
        ))}
        <Line x1={0} y1={baselineY} x2={chartCanvasWidth} y2={baselineY} stroke="#5E7183" strokeWidth={1.5} strokeDasharray="5 5" />
        {displayedStrengthLinePoints.length > 0 ? (
          <Path d={createCurvePath(displayedStrengthLinePoints)} stroke={PROGRESSION_STRENGTH_COLOR} strokeWidth={3} fill="none" />
        ) : null}
        {displayedVolumeLinePoints.length > 0 ? (
          <Path d={createCurvePath(displayedVolumeLinePoints)} stroke={PROGRESSION_VOLUME_COLOR} strokeWidth={3} fill="none" />
        ) : null}
      </Svg>
      <View pointerEvents="none" style={[styles.progressionPointOverlay, { width: chartCanvasWidth, height: lineChartHeight }]}>
        {displayedStrengthPointMarkers.map((point) => (
          <View
            key={`${blockId}-strength-${point.renderKey ?? point.bucketKey}`}
            style={[
              styles.progressionPoint,
              {
                left: point.x - 4.5,
                top: point.y - 4.5,
                backgroundColor: PROGRESSION_STRENGTH_COLOR,
                opacity: point.opacity ?? 1,
              },
            ]}
          />
        ))}
        {displayedVolumePointMarkers.map((point) => (
          <View
            key={`${blockId}-volume-${point.renderKey ?? point.bucketKey}`}
            style={[
              styles.progressionPoint,
              {
                left: point.x - 4.5,
                top: point.y - 4.5,
                backgroundColor: PROGRESSION_VOLUME_COLOR,
                opacity: point.opacity ?? 1,
              },
            ]}
          />
        ))}
      </View>
    </>
  );
});

const progressionBucketAnchorMs = (bucket: WeeklyBucket) => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return Math.min(bucket.end.getTime(), today.getTime());
};

const findProgressionBucketForDate = (buckets: WeeklyBucket[], dateMs?: number) => {
  if (!dateMs || buckets.length === 0) return undefined;
  const match = buckets.find((bucket) => dateMs >= bucket.start.getTime() && dateMs <= bucket.end.getTime());
  if (match) return match;
  if (dateMs < buckets[0].start.getTime()) return buckets[0];
  return buckets[buckets.length - 1];
};

const brzyckiScore = (weightKg: number, reps: number): number | null => {
  if (reps < 1) return null;
  const denominator = 1.0278 - 0.0278 * reps;
  if (denominator <= 0) return null;
  return Math.max(0, weightKg) / denominator;
};

const getExerciseMuscleTags = (
  exercise: LibraryExercise | undefined,
  scope: DistributionScope,
  granularity: DistributionGranularity = 'group',
): string[] => {
  if (!exercise) return [];
  const primary = exercise.primaryMuscle;
  const secondary = exercise.secondaryMuscles ?? [];
  if (!primary) {
    const muscleTags = exercise.tags.filter((tag) => !NON_MUSCLE_TAGS.has(tag));
    if (scope === 'primary') return muscleTags.slice(0, 1);
    if (scope === 'secondary') return muscleTags.slice(1);
    return muscleTags;
  }
  const primarySubs = exercise.primarySubMuscles ?? [];
  const resolvedPrimaries = granularity === 'detail' && primarySubs.length > 0 ? primarySubs : [primary];
  const secondarySubs = exercise.secondarySubMuscles ?? {};
  const resolvedSecondaries = granularity === 'detail'
    ? secondary.flatMap((sec) => (secondarySubs[sec]?.length ? secondarySubs[sec] : [sec]))
    : secondary;
  if (scope === 'primary') return resolvedPrimaries;
  if (scope === 'secondary') return resolvedSecondaries;
  return [...resolvedPrimaries, ...resolvedSecondaries];
};

const startOfWeekLocal = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  const diff = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - diff);
  return next;
};

const getIsoWeekNumber = (date: Date) => {
  const next = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = next.getUTCDay() || 7;
  next.setUTCDate(next.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(next.getUTCFullYear(), 0, 1));
  return Math.ceil((((next.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
};

const formatWeekKey = (date: Date) => formatDateKeyLocal(startOfWeekLocal(date));

const buildTimelineWeeks = (count = 14): WeeklyBucket[] => {
  const currentWeekStart = startOfWeekLocal(new Date());
  const buckets: WeeklyBucket[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const start = new Date(currentWeekStart);
    start.setDate(currentWeekStart.getDate() - offset * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    buckets.push({
      key: formatDateKeyLocal(start),
      start,
      end,
      label: `v${getIsoWeekNumber(start)}`,
      headerLabel: `${shortDate(start)}-${shortDate(end)}`,
    });
  }
  return buckets;
};

const getProgressionRangeStart = (range: ProgressTimeRange, earliestDate?: Date) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (range === 'all') {
    const start = earliestDate ? new Date(earliestDate) : new Date(today);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  const start = new Date(today);
  if (range === '2w') start.setDate(today.getDate() - 13);
  if (range === '2m') start.setMonth(today.getMonth() - 2);
  if (range === '6m') start.setMonth(today.getMonth() - 6);
  return start;
};

const getProgressionTimelineBounds = (range: ProgressTimeRange, earliestDate?: Date) => {
  let start = getProgressionRangeStart(range, earliestDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  if (start.getTime() > end.getTime()) {
    start = new Date(end);
    start.setHours(0, 0, 0, 0);
  }
  return { start, end };
};

const buildProgressionBuckets = (
  granularity: ProgressGranularity,
  range: ProgressTimeRange,
  earliestDate?: Date,
): WeeklyBucket[] => {
  const rangeStart = getProgressionRangeStart(range, earliestDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (granularity === 'day') {
    const buckets: WeeklyBucket[] = [];
    const cursor = new Date(rangeStart);
    while (cursor <= today) {
      const start = new Date(cursor);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      buckets.push({
        key: formatDateKeyLocal(start),
        start,
        end,
        label: shortDate(start),
        headerLabel: `${swedishWeekday(start)} ${shortDate(start)}`,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return buckets;
  }

  if (granularity === 'month') {
    const currentMonth = new Date(today);
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);
    const firstMonth = new Date(rangeStart);
    firstMonth.setDate(1);
    firstMonth.setHours(0, 0, 0, 0);
    const buckets: WeeklyBucket[] = [];
    const cursor = new Date(firstMonth);
    while (cursor <= currentMonth) {
      const start = new Date(cursor);
      const end = new Date(start);
      end.setMonth(start.getMonth() + 1);
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
      buckets.push({
        key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
        start,
        end,
        label: new Intl.DateTimeFormat('sv-SE', { month: 'short' }).format(start),
        headerLabel: monthTitle(start),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return buckets;
  }

  const currentWeekStart = startOfWeekLocal(today);
  const firstWeekStart = startOfWeekLocal(rangeStart);
  const buckets: WeeklyBucket[] = [];
  const cursor = new Date(firstWeekStart);
  while (cursor <= currentWeekStart) {
    const start = new Date(cursor);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    buckets.push({
      key: formatDateKeyLocal(start),
      start,
      end,
      label: `v${getIsoWeekNumber(start)}`,
      headerLabel: `${shortDate(start)}-${shortDate(end)}`,
    });
    cursor.setDate(cursor.getDate() + 7);
  }
  return buckets;
};

const formatProgressionBucketKey = (date: Date, granularity: ProgressGranularity) => {
  if (granularity === 'day') return formatDateKeyLocal(date);
  if (granularity === 'month') return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  return formatWeekKey(date);
};

const normalizeExerciseNameKey = (value: string) => value.trim().toLowerCase();
const isMuscleGroupTag = (tag: string) => !NON_MUSCLE_TAGS.has(tag);
const polarToCartesian = (cx: number, cy: number, radius: number, angleDeg: number) => {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad),
  };
};

const describePieSlice = (cx: number, cy: number, radius: number, startAngle: number, endAngle: number) => {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
    'Z',
  ].join(' ');
};

const roundPercentagesToHundred = (values: number[], total: number): number[] => {
  if (values.length === 0 || total <= 0) return values.map(() => 0);
  const raw = values.map((value) => (value / total) * 100);
  const floors = raw.map((value) => Math.floor(value));
  let remainder = 100 - floors.reduce((sum, value) => sum + value, 0);
  const ranked = raw
    .map((value, index) => ({ index, fraction: value - floors[index], value: values[index] }))
    .sort((a, b) => (
      b.fraction - a.fraction || b.value - a.value || a.index - b.index
    ));
  const rounded = [...floors];

  for (let i = 0; i < ranked.length && remainder > 0; i += 1) {
    rounded[ranked[i].index] += 1;
    remainder -= 1;
  }
  for (let i = ranked.length - 1; i >= 0 && remainder < 0; i -= 1) {
    const idx = ranked[i].index;
    if (rounded[idx] > 0) {
      rounded[idx] -= 1;
      remainder += 1;
    }
  }
  return rounded;
};

function AnalysisScreen({
  exercises,
  logs,
  analysisBlocks,
  setAnalysisBlocks,
  completedWorkouts = [],
  workoutPlans = [],
  gymLibraryExercises = [],
  onPlusActionChange,
}: {
  exercises: Exercise[];
  logs: ExerciseLog[];
  analysisBlocks: AnalysisBlock[];
  setAnalysisBlocks: React.Dispatch<React.SetStateAction<AnalysisBlock[]>>;
  completedWorkouts?: CompletedWorkout[];
  exerciseWeightPbs?: ExerciseWeightPb[];
  workoutPlans?: WorkoutPlan[];
  gymLibraryExercises?: LibraryExercise[];
  onPlusActionChange?: (action: (() => void) | null) => void;
}) {
  const insets = useSafeAreaInsets();
  const chartTopPadding = 12;
  const chartBottomPadding = 36;
  const chartHeight = 240;
  const lineChartHeight = 230;
  const days = useMemo(() => buildTimelineDays(), []);
  const weeks = useMemo(() => buildTimelineWeeks(), []);
  const weekKeySet = useMemo(() => new Set(weeks.map((week) => week.key)), [weeks]);
  const [analysisPickerOpen, setAnalysisPickerOpen] = useState(false);
  const [progressionExercisePickerOpen, setProgressionExercisePickerOpen] = useState(false);
  const [progressionPickerTargetBlockId, setProgressionPickerTargetBlockId] = useState<string | null>(null);
  const [progressionScopePickerOpen, setProgressionScopePickerOpen] = useState(false);
  const [progressionScopePickerTargetBlockId, setProgressionScopePickerTargetBlockId] = useState<string | null>(null);
  const [progressionIntervalModalOpen, setProgressionIntervalModalOpen] = useState(false);
  const [progressionIntervalModalType, setProgressionIntervalModalType] = useState<'reps' | 'weight' | 'time'>('reps');
  const [progressionIntervalTargetBlockId, setProgressionIntervalTargetBlockId] = useState<string | null>(null);
  const [muscleGroupPickerOpen, setMuscleGroupPickerOpen] = useState(false);
  const [progressionInfoOpen, setProgressionInfoOpen] = useState(false);
  const [headerLabelByBlockId, setHeaderLabelByBlockId] = useState<Record<string, string>>({});
  const [focusedWeekKeyByBlockId, setFocusedWeekKeyByBlockId] = useState<Record<string, string>>({});
  const [focusedProgressionDateMsByBlockId, setFocusedProgressionDateMsByBlockId] = useState<Record<string, number>>({});
  const scrollRefsByBlockId = useRef<Record<string, { scrollTo: (options: { x?: number; y?: number; animated?: boolean }) => void } | null>>({});
  const scrollViewportWidthByBlockId = useRef<Record<string, number>>({});
  const progressionChartPositionedByBlockId = useRef<Record<string, boolean>>({});
  const pendingProgressionScrollByBlockId = useRef<Record<string, { x: number; bucket: WeeklyBucket; fallbackKey: string }>>({});
  const progressionScrollLockByBlockId = useRef<Record<string, { dateMs: number }>>({});

  const updateProgressionFocus = useCallback((blockId: string, bucket: WeeklyBucket | undefined, fallbackKey: string) => {
    if (!bucket) return;
    setHeaderLabelByBlockId((prev) => (
      prev[blockId] === bucket.headerLabel ? prev : { ...prev, [blockId]: bucket.headerLabel }
    ));
    setFocusedWeekKeyByBlockId((prev) => (
      prev[blockId] === bucket.key ? prev : { ...prev, [blockId]: bucket.key ?? fallbackKey }
    ));
    const focusedDateMs = progressionBucketAnchorMs(bucket);
    setFocusedProgressionDateMsByBlockId((prev) => (
      prev[blockId] === focusedDateMs ? prev : { ...prev, [blockId]: focusedDateMs }
    ));
  }, []);

  const scrollAnalysisChartTo = useCallback((blockId: string, x: number) => {
    const ref = scrollRefsByBlockId.current[blockId];
    ref?.scrollTo({ x, animated: false });
    requestAnimationFrame(() => scrollRefsByBlockId.current[blockId]?.scrollTo({ x, animated: false }));
  }, []);

  const releaseProgressionScrollLock = useCallback((blockId: string, dateMs: number) => {
    let remainingFrames = 4;
    const tick = () => {
      remainingFrames -= 1;
      if (remainingFrames > 0) {
        requestAnimationFrame(tick);
        return;
      }
      if (progressionScrollLockByBlockId.current[blockId]?.dateMs === dateMs) {
        delete progressionScrollLockByBlockId.current[blockId];
      }
    };
    requestAnimationFrame(tick);
  }, []);

  useLayoutEffect(() => {
    const pendingEntries = Object.entries(pendingProgressionScrollByBlockId.current);
    if (pendingEntries.length === 0) return;
    pendingProgressionScrollByBlockId.current = {};
    pendingEntries.forEach(([blockId, pending]) => {
      updateProgressionFocus(blockId, pending.bucket, pending.fallbackKey);
      progressionChartPositionedByBlockId.current[blockId] = true;
      scrollAnalysisChartTo(blockId, pending.x);
      releaseProgressionScrollLock(blockId, progressionBucketAnchorMs(pending.bucket));
    });
  }, [analysisBlocks, releaseProgressionScrollLock, scrollAnalysisChartTo, updateProgressionFocus]);

  useEffect(() => {
    onPlusActionChange?.(() => setAnalysisPickerOpen(true));
    return () => onPlusActionChange?.(null);
  }, [onPlusActionChange]);

  const gymLibraryById = useMemo(
    () => new Map(gymLibraryExercises.map((exercise) => [exercise.id, exercise])),
    [gymLibraryExercises],
  );
  const gymLibraryByName = useMemo(
    () => new Map(gymLibraryExercises.map((exercise) => [normalizeExerciseNameKey(exercise.name), exercise])),
    [gymLibraryExercises],
  );

  const resolveLibraryExercise = useCallback((exercise: SessionExercise): LibraryExercise | undefined => {
    if (exercise.libraryExerciseId) {
      const byId = gymLibraryById.get(exercise.libraryExerciseId);
      if (byId) return byId;
    }
    return gymLibraryByName.get(normalizeExerciseNameKey(exercise.name));
  }, [gymLibraryById, gymLibraryByName]);

  const progressionScopeOptions = useMemo<ProgressionScopeOption[]>(
    () => [
      { key: 'exercise', label: 'Övning' },
      { key: 'primaryMuscle', label: 'Primär muskel' },
    ],
    [],
  );

  const progressionOptions = useMemo(() => {
    const byKey = new Map<string, ProgressionOption>();
    completedWorkouts.forEach((workout) => {
      workout.exercises.forEach((exercise) => {
        const libraryExercise = resolveLibraryExercise(exercise);
        const key = libraryExercise?.id
          ? `lib:${libraryExercise.id}`
          : `name:${normalizeExerciseNameKey(exercise.name)}`;
        if (!byKey.has(key)) {
          byKey.set(key, { key, label: libraryExercise?.name ?? exercise.name });
        }
      });
    });
    return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label, 'sv'));
  }, [completedWorkouts, resolveLibraryExercise]);

  const { progressionWorkoutRows, progressionPrimaryMuscleOptions } = useMemo(() => {
    const rows: ProgressionWorkoutRow[] = [];
    const primaryMuscleSet = new Set<string>();

    completedWorkouts.forEach((workout) => {
      const weekKey = formatWeekKey(new Date(workout.endedAtIso));

      workout.exercises.forEach((exercise) => {
        const libraryExercise = resolveLibraryExercise(exercise);
        const exerciseKey = libraryExercise?.id
          ? `lib:${libraryExercise.id}`
          : `name:${normalizeExerciseNameKey(exercise.name)}`;
        const primaryMuscleTag = libraryExercise?.primaryMuscle
          ?? libraryExercise?.tags.find(isMuscleGroupTag)
          ?? 'Okänd';

        primaryMuscleSet.add(primaryMuscleTag);

        const setScores = exercise.sets
          .map((setEntry) => {
            const reps = Math.max(0, setEntry.reps);
            const score = brzyckiScore(Math.max(0, setEntry.weightKg), reps);
            return score === null ? null : { reps, score };
          })
          .filter((setScore): setScore is { reps: number; score: number } => setScore !== null);
        if (setScores.length === 0) return;

        rows.push({
          weekKey,
          endedAtIso: workout.endedAtIso,
          exerciseKey,
          primaryMuscleTag,
          setScores,
        });
      });
    });

    return {
      progressionWorkoutRows: rows.sort((a, b) => new Date(a.endedAtIso).getTime() - new Date(b.endedAtIso).getTime()),
      progressionPrimaryMuscleOptions: Array.from(primaryMuscleSet)
        .map((key) => ({ key, label: key }))
        .sort((a, b) => a.label.localeCompare(b.label, 'sv')),
    };
  }, [completedWorkouts, resolveLibraryExercise]);

  const muscleGroupTags = useMemo(
    () => [...new Set(gymLibraryExercises.flatMap((exercise) => {
      const muscles = [exercise.primaryMuscle, ...(exercise.secondaryMuscles ?? [])].filter(Boolean) as string[];
      return muscles.length > 0 ? muscles : exercise.tags.filter(isMuscleGroupTag);
    }))].sort((a, b) => a.localeCompare(b, 'sv')),
    [gymLibraryExercises],
  );

  const muscleDetailTags = useMemo(
    () => [...new Set(gymLibraryExercises.flatMap((exercise) => {
      const primarySubs = exercise.primarySubMuscles ?? [];
      const primaries = primarySubs.length > 0 ? primarySubs : (exercise.primaryMuscle ? [exercise.primaryMuscle] : []);
      const secondary = exercise.secondaryMuscles ?? [];
      const secondarySubs = exercise.secondarySubMuscles ?? {};
      const secondaryResolved = secondary.flatMap((sec) => (secondarySubs[sec]?.length ? secondarySubs[sec] : [sec]));
      const muscles = [...primaries, ...secondaryResolved].filter(Boolean);
      return muscles.length > 0 ? muscles : exercise.tags.filter(isMuscleGroupTag);
    }))].sort((a, b) => a.localeCompare(b, 'sv')),
    [gymLibraryExercises],
  );

  const dailyTargetByExerciseId = useMemo(
    () =>
      new Map(
        exercises.map((exercise) => [
          exercise.id,
          {
            baseTarget: Math.max(1, exercise.times.length || 0),
            activeDays: new Set(parseDaysLabelToJsDays(exercise.daysLabel)),
          },
        ]),
      ),
    [exercises],
  );

  const dayCountsExercises = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    days.forEach((day) => map.set(formatDateKeyLocal(day), {}));
    logs.forEach((log) => {
      const dayKey = formatDateKeyLocal(new Date(log.atIso));
      const dayRow = map.get(dayKey);
      if (!dayRow) return;
      dayRow[log.exerciseId] = (dayRow[log.exerciseId] || 0) + 1;
    });
    return map;
  }, [days, logs]);

  type ScopedWeeklyMap = Record<DistributionScope, Map<string, Map<string, number>>>;

  const { muscleSetsByScope, muscleVolumeByScope, detailSetsByScope, detailVolumeByScope } = useMemo(() => {
    const createEmptyMap = (tagList: string[]): Map<string, Map<string, number>> => {
      const map = new Map<string, Map<string, number>>();
      tagList.forEach((tag) => map.set(tag, new Map(weeks.map((week) => [week.key, 0]))));
      return map;
    };
    const sets: ScopedWeeklyMap = { primary: createEmptyMap(muscleGroupTags), secondary: createEmptyMap(muscleGroupTags), both: createEmptyMap(muscleGroupTags) };
    const vol: ScopedWeeklyMap = { primary: createEmptyMap(muscleGroupTags), secondary: createEmptyMap(muscleGroupTags), both: createEmptyMap(muscleGroupTags) };
    const dSets: ScopedWeeklyMap = { primary: createEmptyMap(muscleDetailTags), secondary: createEmptyMap(muscleDetailTags), both: createEmptyMap(muscleDetailTags) };
    const dVol: ScopedWeeklyMap = { primary: createEmptyMap(muscleDetailTags), secondary: createEmptyMap(muscleDetailTags), both: createEmptyMap(muscleDetailTags) };

    const addToMap = (map: Map<string, Map<string, number>>, tags: string[], weekKey: string, value: number) => {
      tags.forEach((tag) => {
        const row = map.get(tag);
        if (row) row.set(weekKey, (row.get(weekKey) || 0) + value);
      });
    };

    completedWorkouts.forEach((workout) => {
      const weekKey = formatWeekKey(new Date(workout.endedAtIso));
      if (!weekKeySet.has(weekKey)) return;
      workout.exercises.forEach((exercise) => {
        const libraryExercise = resolveLibraryExercise(exercise);
        const setsCount = exercise.sets.filter((setEntry) => setEntry.reps > 0).length;
        const volume = exercise.sets.reduce((sum, setEntry) => (
          setEntry.reps > 0 ? sum + Math.max(0, setEntry.weightKg) * Math.max(0, setEntry.reps) : sum
        ), 0);
        for (const scope of ['primary', 'secondary', 'both'] as DistributionScope[]) {
          const groupTags = getExerciseMuscleTags(libraryExercise, scope, 'group');
          const detailTags = getExerciseMuscleTags(libraryExercise, scope, 'detail');
          addToMap(sets[scope], groupTags, weekKey, setsCount);
          addToMap(vol[scope], groupTags, weekKey, volume);
          addToMap(dSets[scope], detailTags, weekKey, setsCount);
          addToMap(dVol[scope], detailTags, weekKey, volume);
        }
      });
    });
    return { muscleSetsByScope: sets, muscleVolumeByScope: vol, detailSetsByScope: dSets, detailVolumeByScope: dVol };
  }, [completedWorkouts, resolveLibraryExercise, muscleGroupTags, muscleDetailTags, weekKeySet, weeks]);

  const muscleGroupWeeklySets = muscleSetsByScope.both;
  const muscleGroupWeeklyVolume = muscleVolumeByScope.both;

  type ScopedDistribution = Record<DistributionScope, { sets: PieSlice[]; volume: PieSlice[] }>;
  type GranularDistribution = Record<DistributionGranularity, ScopedDistribution>;

  const distributionSlices = useMemo((): GranularDistribution => {
    const buildSlices = (metric: DistributionMetric, scope: DistributionScope, granularity: DistributionGranularity) => {
      const tagList = granularity === 'detail' ? muscleDetailTags : muscleGroupTags;
      const setsSource = granularity === 'detail' ? detailSetsByScope : muscleSetsByScope;
      const volSource = granularity === 'detail' ? detailVolumeByScope : muscleVolumeByScope;
      const source = metric === 'sets' ? setsSource[scope] : volSource[scope];
      const totals = tagList.map((tag, index) => ({
        label: tag,
        value: Array.from(source.get(tag)?.values() ?? []).reduce((sum, value) => sum + value, 0),
        color: SERIES_COLORS[index % SERIES_COLORS.length],
      })).filter((slice) => slice.value > 0)
        .sort((a, b) => b.value - a.value);
      if (totals.length <= 8) return totals;
      const visible = totals.slice(0, 7);
      const restValue = totals.slice(7).reduce((sum, slice) => sum + slice.value, 0);
      return [...visible, { label: 'Övrigt', value: restValue, color: '#5D6D7E' }];
    };
    const buildForGranularity = (granularity: DistributionGranularity): ScopedDistribution => ({
      primary: { sets: buildSlices('sets', 'primary', granularity), volume: buildSlices('volume', 'primary', granularity) },
      secondary: { sets: buildSlices('sets', 'secondary', granularity), volume: buildSlices('volume', 'secondary', granularity) },
      both: { sets: buildSlices('sets', 'both', granularity), volume: buildSlices('volume', 'both', granularity) },
    });
    return { group: buildForGranularity('group'), detail: buildForGranularity('detail') };
  }, [muscleGroupTags, muscleDetailTags, muscleSetsByScope, muscleVolumeByScope, detailSetsByScope, detailVolumeByScope]);

  type ScopedHierarchy = Record<DistributionScope, { sets: HierarchySlice[]; volume: HierarchySlice[] }>;

  const hierarchySlices = useMemo((): ScopedHierarchy => {
    const shadeColor = (hex: string, factor: number): string => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const blend = (c: number) => Math.round(c + (factor > 0 ? (255 - c) * factor : c * factor));
      return `#${[blend(r), blend(g), blend(b)].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('')}`;
    };
    const buildHierarchy = (metric: DistributionMetric, scope: DistributionScope): HierarchySlice[] => {
      const groupSource = metric === 'sets' ? muscleSetsByScope[scope] : muscleVolumeByScope[scope];
      const detailSource = metric === 'sets' ? detailSetsByScope[scope] : detailVolumeByScope[scope];
      const groupTotals = muscleGroupTags.map((tag, index) => ({
        label: tag,
        value: Array.from(groupSource.get(tag)?.values() ?? []).reduce((sum, v) => sum + v, 0),
        color: SERIES_COLORS[index % SERIES_COLORS.length],
      })).filter((s) => s.value > 0).sort((a, b) => b.value - a.value);

      return groupTotals.map((group) => {
        const subs = MUSCLE_SUBGROUPS[group.label];
        if (!subs) return { ...group, children: [] };
        const childData = subs.map((sub) => ({
          label: sub,
          value: Array.from(detailSource.get(sub)?.values() ?? []).reduce((sum, v) => sum + v, 0),
        })).filter((c) => c.value > 0).sort((a, b) => b.value - a.value);
        const childTotal = childData.reduce((sum, c) => sum + c.value, 0);
        const remainder = Math.max(0, group.value - childTotal);
        const normalizedChildren = remainder > 0
          ? [...childData, { label: 'Övrigt', value: remainder }]
          : childData;
        const childPercentages = roundPercentagesToHundred(
          normalizedChildren.map((c) => c.value),
          normalizedChildren.reduce((sum, c) => sum + c.value, 0),
        );
        return {
          ...group,
          children: normalizedChildren.map((c, i) => ({
            ...c,
            pct: childPercentages[i] ?? 0,
            color: shadeColor(group.color, -0.15 + i * 0.15),
          })),
        };
      });
    };
    const buildForScope = (scope: DistributionScope) => ({
      sets: buildHierarchy('sets', scope),
      volume: buildHierarchy('volume', scope),
    });
    return { primary: buildForScope('primary'), secondary: buildForScope('secondary'), both: buildForScope('both') };
  }, [muscleGroupTags, muscleSetsByScope, muscleVolumeByScope, detailSetsByScope, detailVolumeByScope]);

  const maxValueExercises = Math.max(1, ...exercises.map((exercise) => dailyTargetByExerciseId.get(exercise.id)?.baseTarget || 1));
  const drawableChartHeight = chartHeight - chartTopPadding - chartBottomPadding;
  const lineDrawableHeight = lineChartHeight - chartTopPadding - chartBottomPadding;
  const segmentGap = 2;
  const viewportWidth = Dimensions.get('window').width - 32;
  const currentWeekKey = weeks[weeks.length - 1]?.key ?? '';
  const getProgressScope = (block: AnalysisBlock): ProgressScope => block.progressScope ?? 'exercise';
  const getProgressScopeTarget = (block: AnalysisBlock): string => {
    const scope = getProgressScope(block);
    if (scope === 'exercise') return block.exerciseKey ?? '';
    return block.primaryMuscleTag ?? '';
  };
  const visibleBlocks = analysisBlocks.filter((block) => {
    if (block.type === 'exerciseProgression') return !!getProgressScopeTarget(block);
    if (block.type === 'muscleGroupBars') return !!block.muscleGroupTag;
    return true;
  });

  const muscleMetricLabel = (metric: MuscleMetric) => metric === 'sets' ? 'Set' : 'Volym';
  const progressMetricLabel = (metric: ProgressMetric) => metric === 'topset' ? 'Styrka' : 'Volym';
  const progressGranularityLabel = (granularity: ProgressGranularity) => {
    if (granularity === 'day') return 'Dag';
    if (granularity === 'month') return 'Månad';
    return 'Vecka';
  };
  const progressTimeRangeLabel = (range: ProgressTimeRange) => {
    if (range === '2w') return '2v';
    if (range === '2m') return '2m';
    if (range === '6m') return '6m';
    return 'Alla';
  };

  const blockTitle = (block: AnalysisBlock) => {
    if (block.type === 'rehabFrequency') return 'Dagliga övningar';
    if (block.type === 'exerciseProgression') return 'Progression';
    if (block.type === 'muscleGroupBars') return 'Muskelgrupp';
    return 'Fördelning';
  };

  const helpTextByType = (block: AnalysisBlock) => {
    if (block.type === 'rehabFrequency') return 'Varje segment i stapeln = 1 registrering. Linjen visar dagens mål.';
    if (block.type === 'exerciseProgression') {
      return 'Brzycki används bara som intern jämförelse. Index 100 visar din normala nivå.';
    }
    if (block.type === 'muscleGroupBars') {
      return (block.muscleMetric ?? 'sets') === 'sets'
        ? 'Antal set per vecka. Övningar med flera muskelgrupper räknas på varje grupp.'
        : 'Total volym per vecka. Övningar med flera muskelgrupper räknas på varje grupp.';
    }
    return 'Fördelning över de senaste veckorna. Cirkeldiagrammet är ett komplement, inte huvudgrafen.';
  };

  const addBlock = (block: AnalysisBlock) => {
    setAnalysisBlocks((prev) => [...prev, block]);
    setAnalysisPickerOpen(false);
    setProgressionExercisePickerOpen(false);
    setProgressionPickerTargetBlockId(null);
    setProgressionScopePickerOpen(false);
    setProgressionScopePickerTargetBlockId(null);
    setProgressionIntervalModalOpen(false);
    setProgressionIntervalTargetBlockId(null);
    setMuscleGroupPickerOpen(false);
  };

  const createBlockId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const removeBlock = (blockId: string) => {
    setAnalysisBlocks((prev) => prev.filter((block) => block.id !== blockId));
  };

  const updateProgressionExercise = (blockId: string, exerciseKey: string) => {
    setAnalysisBlocks((prev) => prev.map((block) => (
      block.id === blockId ? { ...block, progressScope: 'exercise', exerciseKey } : block
    )));
    setProgressionExercisePickerOpen(false);
    setProgressionPickerTargetBlockId(null);
  };

  const updateProgressionScope = (blockId: string, scope: ProgressScope) => {
    setAnalysisBlocks((prev) => prev.map((block) => {
      if (block.id !== blockId) return block;
      const firstExercise = progressionOptions[0]?.key ?? '';
      const firstMuscle = progressionPrimaryMuscleOptions[0]?.key ?? '';
      if (scope === 'exercise') return { ...block, progressScope: scope, exerciseKey: block.exerciseKey ?? firstExercise };
      return { ...block, progressScope: scope, primaryMuscleTag: block.primaryMuscleTag ?? firstMuscle };
    }));
  };

  const updateProgressionScopeTarget = (blockId: string, value: string) => {
    setAnalysisBlocks((prev) => prev.map((block) => {
      if (block.id !== blockId) return block;
      return { ...block, progressScope: 'primaryMuscle', primaryMuscleTag: value };
    }));
    setProgressionScopePickerOpen(false);
    setProgressionScopePickerTargetBlockId(null);
  };

  const openProgressionIntervalModal = (blockId: string, type: 'reps' | 'weight' | 'time') => {
    setProgressionIntervalTargetBlockId(blockId);
    setProgressionIntervalModalType(type);
    setProgressionIntervalModalOpen(true);
  };

  const renderWeeklyBarChart = (values: number[], color: string) => {
    const maxValue = Math.max(1, ...values);
    return weeks.map((week, index) => {
      const value = values[index] || 0;
      const barWidth = Math.max(8, WEEK_WIDTH - 20);
      const x = index * WEEK_WIDTH + (WEEK_WIDTH - barWidth) / 2;
      const barHeight = maxValue <= 0 ? 0 : (value / maxValue) * drawableChartHeight;
      const y = chartHeight - chartBottomPadding - barHeight;
      return (
        <Rect
          key={`${week.key}-bar`}
          x={x}
          y={y}
          width={barWidth}
          height={Math.max(0, barHeight)}
          fill={color}
          rx={4}
        />
      );
    });
  };

  const renderRehabCard = (block: AnalysisBlock) => (
    <View key={block.id} style={styles.analysisBlockCard}>
      <View style={styles.analysisCardSurface}>
        <View style={styles.analysisBlockHeader}>
          <View style={styles.analysisBlockHeaderText}>
            <Text style={styles.analysisBlockTitle}>{blockTitle(block)}</Text>
            <Text style={styles.analysisBlockSubtitle}>Daglig följsamhet för dina rehabövningar</Text>
          </View>
          <Pressable onPress={() => removeBlock(block.id)} hitSlop={8} style={styles.analysisBlockRemove}>
            <MaterialCommunityIcons name="close" size={22} color="#9AAEC0" />
          </Pressable>
        </View>
        <Text style={styles.monthTitle}>{headerLabelByBlockId[block.id] ?? monthTitle(new Date())}</Text>
        <View style={styles.analysisChartWrap}>
        <ScrollView
          horizontal
          ref={(ref: any) => { scrollRefsByBlockId.current[block.id] = ref; }}
          showsHorizontalScrollIndicator={false}
          onScroll={(event) => {
            const viewportW = event.nativeEvent.layoutMeasurement?.width ?? viewportWidth;
            const centerIndex = Math.round((event.nativeEvent.contentOffset.x + viewportW / 2) / DAY_WIDTH);
            const day = days[Math.max(0, Math.min(days.length - 1, centerIndex))];
            setHeaderLabelByBlockId((prev) => ({ ...prev, [block.id]: monthTitle(day) }));
          }}
          onLayout={(event) => {
            const width = event.nativeEvent.layout.width;
            const todayIndex = 60;
            const x = Math.max(todayIndex * DAY_WIDTH - width / 2 + DAY_WIDTH / 2, 0);
            setTimeout(() => scrollRefsByBlockId.current[block.id]?.scrollTo({ x, animated: false }), 50);
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

              {days.flatMap((day, index) =>
                exercises.map((exercise, barIndex) => {
                  const bars = exercises.length || 1;
                  const barSlotWidth = (DAY_WIDTH - 12) / bars;
                  const value = (dayCountsExercises.get(formatDateKeyLocal(day)) || {})[exercise.id] || 0;
                  const x = index * DAY_WIDTH + 6 + barIndex * barSlotWidth;
                  const barWidth = Math.max(4, barSlotWidth - 2);
                  const targetInfo = dailyTargetByExerciseId.get(exercise.id);
                  const isActiveDay = !!targetInfo && targetInfo.activeDays.has(day.getDay());
                  const targetValue = isActiveDay ? targetInfo?.baseTarget || 1 : 0;
                  const targetY = chartHeight - chartBottomPadding - (targetValue / maxValueExercises) * drawableChartHeight;
                  const unitHeight = drawableChartHeight / maxValueExercises;
                  const segmentHeight = Math.max(2, unitHeight - segmentGap);
                  const segmentCount = Math.max(0, Math.floor(value));
                  return (
                    <React.Fragment key={`${exercise.id}-${formatDateKeyLocal(day)}`}>
                      {Array.from({ length: segmentCount }).map((_, segmentIndex) => {
                        const segmentBottomY = chartHeight - chartBottomPadding - segmentIndex * unitHeight;
                        const y = segmentBottomY - segmentHeight;
                        return (
                          <Rect
                            key={`${exercise.id}-${formatDateKeyLocal(day)}-seg-${segmentIndex}`}
                            x={x}
                            y={y}
                            width={barWidth}
                            height={segmentHeight}
                            fill={exercise.color}
                            rx={2}
                          />
                        );
                      })}
                      {targetValue > 0 ? (
                        <Line x1={x} y1={targetY} x2={x + barWidth} y2={targetY} stroke={exercise.color} strokeWidth={1.6} />
                      ) : null}
                    </React.Fragment>
                  );
                }),
              )}
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
          </View>
        </ScrollView>
        <Text style={styles.chartHelpText}>{helpTextByType(block)}</Text>
        <View style={styles.chartLegend}>
          {exercises.map((exercise) => (
            <View key={exercise.id} style={styles.chartLegendItem}>
              <View style={[styles.dot, { backgroundColor: exercise.color }]} />
              <Text style={styles.chartLegendText} numberOfLines={1}>{exercise.title}</Text>
            </View>
          ))}
        </View>
      </View>
      </View>
    </View>
  );

  const renderProgressionIndexCard = (block: AnalysisBlock) => {
    const progressScope = getProgressScope(block);
    const progressGranularity = block.progressGranularity ?? DEFAULT_PROGRESS_GRANULARITY;
    const progressTimeRange = block.progressTimeRange ?? DEFAULT_PROGRESS_TIME_RANGE;
    const scopeTarget = getProgressScopeTarget(block);
    const scopeOptions = progressScope === 'exercise' ? progressionOptions : progressionPrimaryMuscleOptions;
    const scopeTargetLabel = scopeOptions.find((option) => option.key === scopeTarget)?.label
      ?? (progressScope === 'exercise' ? 'VÃ¤lj Ã¶vning' : 'VÃ¤lj muskel');

    const baseRows = progressionWorkoutRows.map((row) => ({
      weekKey: row.weekKey,
      endedAtIso: row.endedAtIso,
      exerciseKey: row.exerciseKey,
      primaryMuscleTag: row.primaryMuscleTag,
      topsetScore: Math.max(...row.setScores.map((setScore) => setScore.score)),
      volumeScore: row.setScores.reduce((sum, setScore) => sum + setScore.score, 0),
    }));
    const byExercise = new Map<string, Omit<ProgressionScoreRow, 'topsetIndex' | 'volumeIndex'>[]>();
    baseRows.forEach((row) => {
      const rows = byExercise.get(row.exerciseKey) ?? [];
      rows.push(row);
      byExercise.set(row.exerciseKey, rows);
    });

    const scoredRows: ProgressionScoreRow[] = [];
    byExercise.forEach((exerciseRows) => {
      const sortedRows = [...exerciseRows].sort((a, b) => new Date(a.endedAtIso).getTime() - new Date(b.endedAtIso).getTime());
      const referenceRows = sortedRows.slice(-BRZYCKI_REFERENCE_MAX_SESSIONS);
      const referenceTopset = referenceRows.reduce((sum, item) => sum + item.topsetScore, 0) / Math.max(1, referenceRows.length);
      const referenceVolume = referenceRows.reduce((sum, item) => sum + item.volumeScore, 0) / Math.max(1, referenceRows.length);
      sortedRows.forEach((row, index) => {
        scoredRows.push({
          ...row,
          topsetIndex: referenceTopset > 0 ? (row.topsetScore / referenceTopset) * 100 : null,
          volumeIndex: referenceVolume > 0 ? (row.volumeScore / referenceVolume) * 100 : null,
        });
      });
    });

    const scopedRows = scoredRows.filter((row) => (
      progressScope === 'exercise' ? row.exerciseKey === scopeTarget : row.primaryMuscleTag === scopeTarget
    ));
    const earliestScopedDate = scopedRows.length > 0
      ? new Date(Math.min(...scopedRows.map((row) => new Date(row.endedAtIso).getTime())))
      : undefined;
    const progressionBuckets = buildProgressionBuckets(progressGranularity, progressTimeRange, earliestScopedDate);
    const progressionGranularityOptions: ProgressGranularity[] = ['day', 'week', 'month'];
    const progressionScaleBucketsByGranularity = new Map<ProgressGranularity, WeeklyBucket[]>(
      progressionGranularityOptions.map((granularity) => [
        granularity,
        buildProgressionBuckets(granularity, 'all', earliestScopedDate),
      ]),
    );
    const progressionGridBuckets = buildProgressionBuckets('week', progressTimeRange, earliestScopedDate);
    const progressionAxisBuckets = progressGranularity === 'month'
      ? buildProgressionBuckets('month', progressTimeRange, earliestScopedDate)
      : progressionGridBuckets;
    const progressionCurrentKey = progressionBuckets[progressionBuckets.length - 1]?.key ?? currentWeekKey;
    const buildBucketValues = (granularity: ProgressGranularity, buckets: WeeklyBucket[]) => {
      const bucketKeySet = new Set(buckets.map((bucket) => bucket.key));
      const rowsByBucket = new Map<string, ProgressionScoreRow[]>();
      scopedRows.forEach((row) => {
        const bucketKey = formatProgressionBucketKey(new Date(row.endedAtIso), granularity);
        if (!bucketKeySet.has(bucketKey)) return;
        const rows = rowsByBucket.get(bucketKey) ?? [];
        rows.push(row);
        rowsByBucket.set(bucketKey, rows);
      });

      const strengthByKeyForBuckets = new Map<string, number | null>(buckets.map((bucket) => [bucket.key, null]));
      const volumeByKeyForBuckets = new Map<string, number | null>(buckets.map((bucket) => [bucket.key, null]));
      rowsByBucket.forEach((rowsInBucket, bucketKey) => {
        const strengthValues = rowsInBucket.map((row) => row.topsetIndex).filter((value): value is number => value !== null);
        const volumeValues = rowsInBucket.map((row) => row.volumeIndex).filter((value): value is number => value !== null);
        if (strengthValues.length > 0) strengthByKeyForBuckets.set(bucketKey, strengthValues.reduce((sum, value) => sum + value, 0) / strengthValues.length);
        if (volumeValues.length > 0) volumeByKeyForBuckets.set(bucketKey, volumeValues.reduce((sum, value) => sum + value, 0) / volumeValues.length);
      });
      return { strengthByKey: strengthByKeyForBuckets, volumeByKey: volumeByKeyForBuckets };
    };
    const activeBucketValues = buildBucketValues(progressGranularity, progressionBuckets);
    const { strengthByKey, volumeByKey } = activeBucketValues;

    const formatScore = (value: number | null | undefined) => {
      if (value === null || value === undefined || !Number.isFinite(value)) return '--';
      return Number.isInteger(value) ? `${value}` : value.toFixed(1);
    };
    const formatTrendPct = (value: number | null | undefined) => {
      if (value === null || value === undefined || !Number.isFinite(value)) return '--';
      const sign = value > 0 ? '+' : '';
      return `${sign}${value.toFixed(1)}%`;
    };
    const allValues = progressionGranularityOptions.flatMap((granularity) => {
      const buckets = progressionScaleBucketsByGranularity.get(granularity) ?? [];
      const values = buildBucketValues(granularity, buckets);
      return [
        ...Array.from(values.strengthByKey.values()).filter((value): value is number => value !== null),
        ...Array.from(values.volumeByKey.values()).filter((value): value is number => value !== null),
      ];
    });
    const scaleValues = [
      ...allValues,
      100,
    ];
    const baselineY = chartTopPadding + lineDrawableHeight / 2;
    const baselineSpace = Math.max(1, Math.min(baselineY - chartTopPadding, chartTopPadding + lineDrawableHeight - baselineY));
    const maxDeviation = Math.max(10, ...scaleValues.map((value) => Math.abs(value - 100))) * 1.18;
    const yForValue = (value: number) => baselineY - ((value - 100) / maxDeviation) * baselineSpace;
    const buildTimelineMetrics = (range: ProgressTimeRange, viewportW: number) => {
      const { start, end } = getProgressionTimelineBounds(range, earliestScopedDate);
      const timelineStartMs = start.getTime();
      const timelineEndMs = end.getTime();
      const timelineDurationMs = Math.max(DAY_MS, timelineEndMs - timelineStartMs);
      const timelinePixelsPerMs = WEEK_WIDTH / PROGRESSION_GRID_INTERVAL_MS;
      const chartWidthForRange = Math.max(
        WEEK_WIDTH * 2,
        timelineDurationMs * timelinePixelsPerMs + PROGRESSION_TIMELINE_SIDE_PADDING * 2,
      );
      const chartCanvasWidthForRange = Math.max(viewportW, chartWidthForRange);
      const chartStartXForRange = Math.max(0, chartCanvasWidthForRange - chartWidthForRange);
      const timelineEndX = chartStartXForRange + chartWidthForRange - PROGRESSION_TIMELINE_SIDE_PADDING;
      const xForDateMsInRange = (dateMs: number) => {
        return timelineEndX - (timelineEndMs - dateMs) * timelinePixelsPerMs;
      };
      const dateMsForXInRange = (x: number) => {
        const clampedX = clampNumber(
          x,
          chartStartXForRange + PROGRESSION_TIMELINE_SIDE_PADDING,
          timelineEndX,
        );
        return timelineEndMs - ((timelineEndX - clampedX) / timelinePixelsPerMs);
      };
      return {
        chartWidth: chartWidthForRange,
        chartCanvasWidth: chartCanvasWidthForRange,
        chartStartX: chartStartXForRange,
        xForDateMs: xForDateMsInRange,
        dateMsForX: dateMsForXInRange,
      };
    };
    const timelineMetrics = buildTimelineMetrics(progressTimeRange, viewportWidth);
    const { chartWidth, chartCanvasWidth, chartStartX, xForDateMs, dateMsForX } = timelineMetrics;
    const formatAxisLabels = (bucket: WeeklyBucket) => {
      if (progressGranularity === 'day') {
        return { primary: shortDate(bucket.start), secondary: swedishWeekday(bucket.start) };
      }
      if (progressGranularity === 'month') {
        return {
          primary: new Intl.DateTimeFormat('sv-SE', { month: 'short' }).format(bucket.start).replace('.', ''),
          secondary: `${bucket.start.getFullYear()}`,
        };
      }
      return { primary: bucket.label, secondary: shortDate(bucket.start) };
    };
    const buildPoints = (source: Map<string, number | null>) => progressionBuckets
      .map((bucket) => {
        const value = source.get(bucket.key) ?? null;
        if (value === null) return null;
        const dateMs = progressionBucketAnchorMs(bucket);
        return {
          x: xForDateMs(dateMs),
          y: yForValue(value),
          value,
          bucketKey: bucket.key,
          dateMs,
        };
      })
      .filter((point): point is ProgressionChartPoint => point !== null);
    const strengthPoints = buildPoints(strengthByKey);
    const volumePoints = buildPoints(volumeByKey);
    const progressionGridLines = progressionGridBuckets.map((bucket) => ({
      key: bucket.key,
      x: xForDateMs(bucket.start.getTime()),
    }));
    const valuesByKey = new Map<string, { strength: number | null; volume: number | null }>(
      progressionBuckets.map((bucket) => [bucket.key, { strength: strengthByKey.get(bucket.key) ?? null, volume: volumeByKey.get(bucket.key) ?? null }]),
    );
    const bucketsWithData = progressionBuckets.filter((bucket) => {
      const values = valuesByKey.get(bucket.key);
      return !!values && (values.strength !== null || values.volume !== null);
    });
    const strengthBucketsWithData = progressionBuckets.filter((bucket) => valuesByKey.get(bucket.key)?.strength !== null);
    const volumeBucketsWithData = progressionBuckets.filter((bucket) => valuesByKey.get(bucket.key)?.volume !== null);
    const firstStrengthValue = strengthBucketsWithData[0] ? valuesByKey.get(strengthBucketsWithData[0].key)?.strength : null;
    const latestStrengthValue = strengthBucketsWithData[strengthBucketsWithData.length - 1]
      ? valuesByKey.get(strengthBucketsWithData[strengthBucketsWithData.length - 1].key)?.strength
      : null;
    const firstVolumeValue = volumeBucketsWithData[0] ? valuesByKey.get(volumeBucketsWithData[0].key)?.volume : null;
    const latestVolumeValue = volumeBucketsWithData[volumeBucketsWithData.length - 1]
      ? valuesByKey.get(volumeBucketsWithData[volumeBucketsWithData.length - 1].key)?.volume
      : null;
    const strengthTrendPct = latestStrengthValue !== null && latestStrengthValue !== undefined && firstStrengthValue !== null && firstStrengthValue !== undefined && firstStrengthValue > 0
      ? ((latestStrengthValue - firstStrengthValue) / firstStrengthValue) * 100
      : null;
    const volumeTrendPct = latestVolumeValue !== null && latestVolumeValue !== undefined && firstVolumeValue !== null && firstVolumeValue !== undefined && firstVolumeValue > 0
      ? ((latestVolumeValue - firstVolumeValue) / firstVolumeValue) * 100
      : null;
    const fallbackFocusedBucket = bucketsWithData[bucketsWithData.length - 1] ?? progressionBuckets[progressionBuckets.length - 1];
    const lockedFocusedBucket = findProgressionBucketForDate(progressionBuckets, progressionScrollLockByBlockId.current[block.id]?.dateMs);
    const storedFocusedBucket = findProgressionBucketForDate(progressionBuckets, focusedProgressionDateMsByBlockId[block.id]);
    const focusedBucket = lockedFocusedBucket ?? storedFocusedBucket ?? fallbackFocusedBucket;
    const hasAnyIndexData = strengthPoints.length > 0 || volumePoints.length > 0;
    const scrollToBucket = (bucket: WeeklyBucket | undefined, viewportW: number) => {
      if (!bucket || viewportW <= 0) return;
      const maxX = Math.max(0, chartCanvasWidth - viewportW);
      const bucketCenterX = xForDateMs(progressionBucketAnchorMs(bucket));
      const x = Math.min(Math.max(bucketCenterX - viewportW / 2, 0), maxX);
      updateProgressionFocus(block.id, bucket, progressionCurrentKey);
      scrollAnalysisChartTo(block.id, x);
    };
    const queueScrollForProgressionWindow = (nextGranularity: ProgressGranularity, nextRange: ProgressTimeRange) => {
      const nextBuckets = buildProgressionBuckets(nextGranularity, nextRange, earliestScopedDate);
      const focusDateMs = progressionScrollLockByBlockId.current[block.id]?.dateMs
        ?? focusedProgressionDateMsByBlockId[block.id]
        ?? (focusedBucket ? progressionBucketAnchorMs(focusedBucket) : undefined);
      const targetBucket = findProgressionBucketForDate(nextBuckets, focusDateMs)
        ?? nextBuckets[nextBuckets.length - 1];
      if (!targetBucket) return;
      const targetDateMs = progressionBucketAnchorMs(targetBucket);
      progressionScrollLockByBlockId.current[block.id] = { dateMs: targetDateMs };
      const viewportW = scrollViewportWidthByBlockId.current[block.id] ?? viewportWidth;
      const nextTimelineMetrics = buildTimelineMetrics(nextRange, viewportW);
      const targetCenterX = nextTimelineMetrics.xForDateMs(targetDateMs);
      const maxX = Math.max(0, nextTimelineMetrics.chartCanvasWidth - viewportW);
      const x = Math.min(Math.max(targetCenterX - viewportW / 2, 0), maxX);
      pendingProgressionScrollByBlockId.current[block.id] = {
        x,
        bucket: targetBucket,
        fallbackKey: nextBuckets[nextBuckets.length - 1]?.key ?? progressionCurrentKey,
      };
    };

    return (
      <View key={block.id} style={styles.analysisBlockCard}>
        <View style={styles.analysisCardSurface}>
          <View style={styles.analysisBlockHeader}>
            <View style={styles.analysisBlockHeaderText}>
              <Text style={styles.analysisBlockTitle}>{blockTitle(block)} - {scopeTargetLabel}</Text>
              <Text style={styles.analysisPbJumpText}>
                <Text style={{ color: PROGRESSION_STRENGTH_COLOR }}>Styrka {formatTrendPct(strengthTrendPct)} ({formatScore(latestStrengthValue)})</Text>
                {'  '}
                <Text style={{ color: PROGRESSION_VOLUME_COLOR }}>Volym {formatTrendPct(volumeTrendPct)} ({formatScore(latestVolumeValue)})</Text>
              </Text>
            </View>
            <View style={styles.analysisBlockHeaderActions}>
              <Pressable onPress={() => setProgressionInfoOpen(true)} hitSlop={8} style={styles.analysisBlockIconButton}>
                <MaterialCommunityIcons name="information-outline" size={21} color="#9AAEC0" />
              </Pressable>
              <Pressable onPress={() => removeBlock(block.id)} hitSlop={8} style={styles.analysisBlockIconButton}>
                <MaterialCommunityIcons name="close" size={22} color="#9AAEC0" />
              </Pressable>
            </View>
          </View>
          {false ? <View style={[styles.analysisControlRow, { display: 'none' }]}>
            <Button
              mode="outlined"
              compact
              textColor="#90CAF9"
              icon="chevron-down"
              onPress={() => {
                if (progressScope === 'exercise') {
                  setProgressionPickerTargetBlockId(block.id);
                  setProgressionExercisePickerOpen(true);
                  return;
                }
                setProgressionScopePickerTargetBlockId(block.id);
                setProgressionScopePickerOpen(true);
              }}
            >
              {progressScope === 'exercise' ? 'Byt Ã¶vning' : 'Byt muskel'}
            </Button>
          </View> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.analysisMetricRow} contentContainerStyle={styles.analysisMetricRowContent}>
            {progressionScopeOptions.map((option) => {
              const active = progressScope === option.key;
              return (
                <Pressable
                  key={option.key}
                  style={[styles.chip, styles.analysisMetricChip, active && styles.chipActive]}
                  onPress={() => {
                    const nextScope = option.key as ProgressScope;
                    updateProgressionScope(block.id, nextScope);
                    if (nextScope === 'exercise') {
                      setProgressionPickerTargetBlockId(block.id);
                      setProgressionExercisePickerOpen(true);
                      return;
                    }
                    setProgressionScopePickerTargetBlockId(block.id);
                    setProgressionScopePickerOpen(true);
                  }}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.analysisCompactFiltersRow}>
            {(['day', 'week', 'month'] as ProgressGranularity[]).map((option) => {
              const active = progressGranularity === option;
              return (
                <Pressable
                  key={option}
                  style={[styles.analysisIntervalButton, active && styles.chipActive]}
                  onPress={() =>
                    {
                      if (active) return;
                      progressionChartPositionedByBlockId.current[block.id] = false;
                      queueScrollForProgressionWindow(option, progressTimeRange);
                      setAnalysisBlocks((prev) => prev.map((item) => (
                        item.id === block.id ? { ...item, progressGranularity: option } : item
                      )));
                    }
                  }
                >
                  <Text style={[styles.analysisIntervalButtonText, active && styles.chipTextActive]}>{progressGranularityLabel(option)}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.analysisRangeText}>{headerLabelByBlockId[block.id] ?? focusedBucket?.headerLabel ?? progressionBuckets[progressionBuckets.length - 1]?.headerLabel}</Text>
          <View style={styles.analysisChartWrap}>
            <ScrollView
              horizontal
              ref={(ref: any) => { scrollRefsByBlockId.current[block.id] = ref; }}
              showsHorizontalScrollIndicator={false}
              onScroll={(event) => {
                if (progressionScrollLockByBlockId.current[block.id]) return;
                const viewportW = event.nativeEvent.layoutMeasurement?.width ?? viewportWidth;
                const centerX = chartWidth <= viewportW
                  ? chartStartX + chartWidth - PROGRESSION_TIMELINE_SIDE_PADDING
                  : event.nativeEvent.contentOffset.x + viewportW / 2;
                const bucket = findProgressionBucketForDate(progressionBuckets, dateMsForX(centerX))
                  ?? progressionBuckets[progressionBuckets.length - 1];
                updateProgressionFocus(block.id, bucket, progressionCurrentKey);
              }}
              onLayout={(event) => {
                const width = event.nativeEvent.layout.width;
                const previousWidth = scrollViewportWidthByBlockId.current[block.id];
                scrollViewportWidthByBlockId.current[block.id] = width;
                if (pendingProgressionScrollByBlockId.current[block.id]) return;
                if (progressionChartPositionedByBlockId.current[block.id] && previousWidth === width) return;
                progressionChartPositionedByBlockId.current[block.id] = true;
                scrollToBucket(focusedBucket, width);
              }}
              scrollEventThrottle={16}
            >
              <View>
                <View style={styles.progressionChartCanvas}>
                  <ProgressionLineChart
                    animateKey={progressGranularity}
                    baselineY={baselineY}
                    blockId={block.id}
                    chartCanvasWidth={chartCanvasWidth}
                    gridLines={progressionGridLines}
                    lineChartHeight={lineChartHeight}
                    strengthPoints={strengthPoints}
                    volumePoints={volumePoints}
                  />
                </View>
                <View style={[styles.progressionAxisRow, { width: chartCanvasWidth }]}>
                  {progressionAxisBuckets.map((bucket) => {
                    const x = xForDateMs(bucket.start.getTime());
                    const left = clampNumber(x - WEEK_WIDTH / 2, 0, Math.max(0, chartCanvasWidth - WEEK_WIDTH));
                    const labels = formatAxisLabels(bucket);
                    return (
                      <View key={`${bucket.key}-axis`} style={[styles.progressionAxisItem, { left }]}>
                        <Text style={styles.axisWeek}>{labels.primary}</Text>
                        <Text style={styles.axisDate}>{labels.secondary}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            </ScrollView>
            {!hasAnyIndexData ? <Text style={styles.analysisNoDataText}>Ingen träningsdata för valt filter ännu.</Text> : null}
          </View>
          <View style={styles.analysisCompactFiltersRow}>
            {(['2w', '2m', '6m', 'all'] as ProgressTimeRange[]).map((option) => {
              const active = progressTimeRange === option;
              return (
                <Pressable
                  key={option}
                  style={[styles.analysisIntervalButton, active && styles.chipActive]}
                  onPress={() =>
                    {
                      if (active) return;
                      progressionChartPositionedByBlockId.current[block.id] = false;
                      queueScrollForProgressionWindow(progressGranularity, option);
                      setAnalysisBlocks((prev) => prev.map((item) => (
                        item.id === block.id ? { ...item, progressTimeRange: option } : item
                      )));
                    }
                  }
                >
                  <Text style={[styles.analysisIntervalButtonText, active && styles.chipTextActive]}>{progressTimeRangeLabel(option)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    );
  };

  const renderProgressionCard = (block: AnalysisBlock) => {
    const progressScope = getProgressScope(block);
    const progressMetric = block.progressMetric ?? 'topset';
    const repMin = Math.max(DEFAULT_REP_MIN, block.repMin ?? DEFAULT_REP_MIN);
    const repMax = Math.max(repMin, block.repMax ?? DEFAULT_REP_MAX);
    const lookbackWeeks = Math.max(MIN_LOOKBACK_WEEKS, Math.min(MAX_LOOKBACK_WEEKS, Math.round(block.lookbackWeeks ?? DEFAULT_LOOKBACK_WEEKS)));
    const comparisonWeeks = buildTimelineWeeks(lookbackWeeks * 2);
    const previousWeeks = comparisonWeeks.slice(0, lookbackWeeks);
    const progressionWeeks = comparisonWeeks.slice(lookbackWeeks);
    const progressionCurrentWeekKey = progressionWeeks[progressionWeeks.length - 1]?.key ?? currentWeekKey;
    const scopeTarget = getProgressScopeTarget(block);

    const scopeLabel = progressionScopeOptions.find((option) => option.key === progressScope)?.label ?? 'Övning';
    const scopeOptions = progressScope === 'exercise'
      ? progressionOptions
      : progressionPrimaryMuscleOptions;
    const scopeTargetLabel = scopeOptions.find((option) => option.key === scopeTarget)?.label
      ?? (progressScope === 'exercise' ? 'Välj övning' : 'Välj muskel');
    const scoredRowsWithoutIndex = progressionWorkoutRows
      .map((row) => {
        const setScores = row.setScores.filter((setScore) => setScore.reps >= repMin && setScore.reps <= repMax);
        if (setScores.length === 0) return null;
        return {
          weekKey: row.weekKey,
          endedAtIso: row.endedAtIso,
          exerciseKey: row.exerciseKey,
          primaryMuscleTag: row.primaryMuscleTag,
          topsetScore: Math.max(...setScores.map((setScore) => setScore.score)),
          volumeScore: setScores.reduce((sum, setScore) => sum + setScore.score, 0),
        };
      })
      .filter((row): row is Omit<ProgressionScoreRow, 'topsetIndex' | 'volumeIndex'> => row !== null);

    const byExercise = new Map<string, Omit<ProgressionScoreRow, 'topsetIndex' | 'volumeIndex'>[]>();
    scoredRowsWithoutIndex.forEach((row) => {
      const rows = byExercise.get(row.exerciseKey) ?? [];
      rows.push(row);
      byExercise.set(row.exerciseKey, rows);
    });

    const scoredRows: ProgressionScoreRow[] = [];
    byExercise.forEach((exerciseRows) => {
      const sortedRows = [...exerciseRows].sort((a, b) => new Date(a.endedAtIso).getTime() - new Date(b.endedAtIso).getTime());
      sortedRows.forEach((row, index) => {
        const referenceRows = sortedRows.slice(Math.max(0, index - BRZYCKI_REFERENCE_MAX_SESSIONS), index);
        const hasReference = referenceRows.length >= BRZYCKI_REFERENCE_MIN_SESSIONS;
        const referenceTopset = hasReference
          ? referenceRows.reduce((sum, item) => sum + item.topsetScore, 0) / referenceRows.length
          : 0;
        const referenceVolume = hasReference
          ? referenceRows.reduce((sum, item) => sum + item.volumeScore, 0) / referenceRows.length
          : 0;
        scoredRows.push({
          ...row,
          topsetIndex: hasReference && referenceTopset > 0 ? (row.topsetScore / referenceTopset) * 100 : null,
          volumeIndex: hasReference && referenceVolume > 0 ? (row.volumeScore / referenceVolume) * 100 : null,
        });
      });
    });

    const scopedRows = scoredRows.filter((row) => (
      progressScope === 'exercise' ? row.exerciseKey === scopeTarget : row.primaryMuscleTag === scopeTarget
    ));
    const scoreKey = progressMetric === 'topset' ? 'topsetScore' : 'volumeScore';
    const indexKey = progressMetric === 'topset' ? 'topsetIndex' : 'volumeIndex';
    const metricColor = progressMetric === 'topset' ? '#90CAF9' : '#C8E57A';

    const weeklyValueByKey = new Map<string, number>(comparisonWeeks.map((week) => [week.key, 0]));
    comparisonWeeks.forEach((week) => {
      const rowsInWeek = scopedRows.filter((row) => row.weekKey === week.key);
      if (rowsInWeek.length === 0) return;
      if (progressScope === 'exercise') {
        const value = progressMetric === 'topset'
          ? Math.max(...rowsInWeek.map((row) => row.topsetScore))
          : rowsInWeek.reduce((sum, row) => sum + row.volumeScore, 0);
        weeklyValueByKey.set(week.key, value);
        return;
      }
      const indexedValues = rowsInWeek
        .map((row) => row[indexKey])
        .filter((value): value is number => value !== null);
      if (indexedValues.length > 0) {
        weeklyValueByKey.set(week.key, indexedValues.reduce((sum, value) => sum + value, 0) / indexedValues.length);
      }
    });

    const currentPeriodValue = progressionWeeks.reduce((sum, week) => sum + (weeklyValueByKey.get(week.key) || 0), 0);
    const previousPeriodValue = previousWeeks.reduce((sum, week) => sum + (weeklyValueByKey.get(week.key) || 0), 0);
    const periodProgressPct = previousPeriodValue > 0
      ? ((currentPeriodValue - previousPeriodValue) / previousPeriodValue) * 100
      : null;

    const values = progressionWeeks.map((week) => weeklyValueByKey.get(week.key) || 0);
    const maxValue = Math.max(1, ...values);
    const weeklyDeltaPctByKey = new Map<string, number | null>();
    let previousValueWithData: number | null = null;
    progressionWeeks.forEach((week) => {
      const value = weeklyValueByKey.get(week.key) || 0;
      if (value > 0 && previousValueWithData && previousValueWithData > 0) {
        weeklyDeltaPctByKey.set(week.key, ((value - previousValueWithData) / previousValueWithData) * 100);
      } else {
        weeklyDeltaPctByKey.set(week.key, null);
      }
      if (value > 0) previousValueWithData = value;
    });

    const focusedWeekKey = focusedWeekKeyByBlockId[block.id] ?? progressionCurrentWeekKey;
    const focusedWeek = progressionWeeks.find((week) => week.key === focusedWeekKey);
    const focusedDeltaPct = focusedWeek ? (weeklyDeltaPctByKey.get(focusedWeek.key) ?? null) : null;
    const focusedValue = focusedWeek ? (weeklyValueByKey.get(focusedWeek.key) || 0) : 0;

    const points = progressionWeeks
      .map((week, index) => ({
        x: index * WEEK_WIDTH + WEEK_WIDTH / 2,
        y: lineChartHeight - chartBottomPadding - ((weeklyValueByKey.get(week.key) || 0) / maxValue) * lineDrawableHeight,
        value: weeklyValueByKey.get(week.key) || 0,
        weekKey: week.key,
        deltaPct: weeklyDeltaPctByKey.get(week.key) ?? null,
      }))
      .filter((point) => point.value > 0);
    const formatPct = (value: number | null) => {
      if (value === null || !Number.isFinite(value)) return '--';
      const sign = value > 0 ? '+' : '';
      return `${sign}${value.toFixed(1)}%`;
    };
    const formatScore = (value: number) => (
      Number.isInteger(value) ? `${value}` : value.toFixed(1)
    );
    const latestRows = [...scopedRows].sort((a, b) => new Date(b.endedAtIso).getTime() - new Date(a.endedAtIso).getTime());
    const latestRow = latestRows[0];
    const previousExerciseRow = progressScope === 'exercise' ? latestRows[1] : undefined;
    const latestScoreValue = latestRow ? latestRow[scoreKey] : null;
    const previousScoreValue = previousExerciseRow ? previousExerciseRow[scoreKey] : null;
    const latestWeeklyIndexValue = [...progressionWeeks]
      .reverse()
      .map((week) => weeklyValueByKey.get(week.key) || 0)
      .find((value) => value > 0) ?? null;
    const previousPassPct = latestScoreValue !== null && previousScoreValue && previousScoreValue > 0
      ? ((latestScoreValue - previousScoreValue) / previousScoreValue) * 100
      : null;
    const pbValue = scopedRows.length > 0 ? Math.max(...scopedRows.map((row) => row[scoreKey])) : null;
    const pbPct = progressScope === 'exercise' && latestScoreValue !== null && pbValue && pbValue > 0
      ? ((latestScoreValue - pbValue) / pbValue) * 100
      : null;
    const focusedDeltaColor = focusedDeltaPct === null ? styles.deltaNeutral : focusedDeltaPct >= 0 ? styles.deltaPositive : styles.deltaNegative;
    const periodProgressText = periodProgressPct !== null ? formatPct(periodProgressPct) : '--';
    const timeButtonText = `Tid-intervall ${lookbackWeeks}v`;
    const repButtonText = `Reps-intervall ${repMin}-${repMax}`;
    const activeWeekCount = progressionWeeks.filter((week) => (weeklyValueByKey.get(week.key) || 0) > 0).length;
    const primaryValueLabel = progressScope === 'exercise'
      ? `${progressMetric === 'topset' ? 'TopsetScore' : 'VolumeScore'} ${latestScoreValue !== null ? formatScore(latestScoreValue) : '--'}`
      : `${progressMetric === 'topset' ? 'MuscleGroupTopsetIndex' : 'MuscleGroupVolumeIndex'} ${latestWeeklyIndexValue !== null ? formatScore(latestWeeklyIndexValue) : '--'}`;
    const comparisonLabel = progressScope === 'exercise'
      ? `Senaste pass ${formatPct(previousPassPct)} • PB ${pbValue !== null ? formatScore(pbValue) : '--'} (${formatPct(pbPct)})`
      : `Period ${periodProgressText} mot foregaende ${lookbackWeeks}v`;
    const periodValueLabel = progressScope === 'exercise'
      ? `${formatScore(currentPeriodValue)} nu vs ${formatScore(previousPeriodValue)} foregaende`
      : `${activeWeekCount > 0 ? formatScore(currentPeriodValue / activeWeekCount) : '--'} indexsnitt i perioden`;

    return (
      <View key={block.id} style={styles.analysisBlockCard}>
        <View style={styles.analysisCardSurface}>
          <View style={styles.analysisBlockHeader}>
            <View style={styles.analysisBlockHeaderText}>
              <Text style={styles.analysisBlockTitle}>{blockTitle(block)} - {scopeTargetLabel}</Text>
              <Text style={styles.analysisBlockSubtitle}>{scopeLabel}</Text>
              <Text style={styles.analysisPbJumpText}>
                {primaryValueLabel}
              </Text>
              <Text style={styles.analysisBlockSubtitle}>
                {comparisonLabel}
              </Text>
              <Text style={styles.analysisBlockSubtitle}>
                {periodValueLabel}
              </Text>
            </View>
            <Pressable onPress={() => removeBlock(block.id)} hitSlop={8} style={styles.analysisBlockRemove}>
              <MaterialCommunityIcons name="close" size={22} color="#9AAEC0" />
            </Pressable>
          </View>
          <View style={styles.analysisControlRow}>
            <Button
              mode="outlined"
              compact
              textColor="#90CAF9"
              icon="chevron-down"
              onPress={() => {
                if (progressScope === 'exercise') {
                  setProgressionPickerTargetBlockId(block.id);
                  setProgressionExercisePickerOpen(true);
                  return;
                }
                setProgressionScopePickerTargetBlockId(block.id);
                setProgressionScopePickerOpen(true);
              }}
            >
              {progressScope === 'exercise' ? 'Byt övning' : 'Byt muskel'}
            </Button>
          </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.analysisMetricRow} contentContainerStyle={styles.analysisMetricRowContent}>
          {(['topset', 'volume'] as ProgressMetric[]).map((option) => {
            const active = progressMetric === option;
            return (
              <Pressable
                key={option}
                style={[styles.chip, styles.analysisMetricChip, active && styles.chipActive]}
                onPress={() =>
                  setAnalysisBlocks((prev) => prev.map((item) => (
                    item.id === block.id ? { ...item, progressMetric: option } : item
                  )))
                }
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{progressMetricLabel(option)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.analysisMetricRow} contentContainerStyle={styles.analysisMetricRowContent}>
          {progressionScopeOptions.map((option) => {
            const active = progressScope === option.key;
            return (
              <Pressable
                key={option.key}
                style={[styles.chip, styles.analysisMetricChip, active && styles.chipActive]}
                onPress={() =>
                  updateProgressionScope(block.id, option.key as ProgressScope)
                }
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.analysisCompactFiltersRow}>
          <Pressable style={styles.analysisIntervalButton} onPress={() => openProgressionIntervalModal(block.id, 'reps')}>
            <Text style={styles.analysisIntervalButtonText}>{repButtonText}</Text>
          </Pressable>
          <Pressable style={styles.analysisIntervalButton} onPress={() => openProgressionIntervalModal(block.id, 'time')}>
            <Text style={styles.analysisIntervalButtonText}>{timeButtonText}</Text>
          </Pressable>
        </View>
        <Text style={styles.analysisRangeText}>Reps {repMin}-{repMax} • Brzycki-score • {lookbackWeeks}v</Text>
        <Text style={styles.analysisRangeText}>{headerLabelByBlockId[block.id] ?? progressionWeeks[progressionWeeks.length - 1]?.headerLabel}</Text>
        <View style={styles.analysisChartWrap}>
          <ScrollView
            horizontal
            ref={(ref: any) => { scrollRefsByBlockId.current[block.id] = ref; }}
            showsHorizontalScrollIndicator={false}
            onScroll={(event) => {
              const viewportW = event.nativeEvent.layoutMeasurement?.width ?? viewportWidth;
              const centerIndex = Math.round((event.nativeEvent.contentOffset.x + viewportW / 2) / WEEK_WIDTH);
              const week = progressionWeeks[Math.max(0, Math.min(progressionWeeks.length - 1, centerIndex))];
              setHeaderLabelByBlockId((prev) => ({ ...prev, [block.id]: week.headerLabel }));
              setFocusedWeekKeyByBlockId((prev) => ({ ...prev, [block.id]: week.key }));
            }}
            onLayout={(event) => {
              const width = event.nativeEvent.layout.width;
              const currentIndex = progressionWeeks.length - 1;
              const x = Math.max(currentIndex * WEEK_WIDTH - width / 2 + WEEK_WIDTH / 2, 0);
              setFocusedWeekKeyByBlockId((prev) => ({ ...prev, [block.id]: progressionWeeks[currentIndex]?.key ?? progressionCurrentWeekKey }));
              setTimeout(() => scrollRefsByBlockId.current[block.id]?.scrollTo({ x, animated: false }), 50);
            }}
            scrollEventThrottle={16}
          >
            <View>
              <Svg width={progressionWeeks.length * WEEK_WIDTH} height={lineChartHeight}>
                {progressionWeeks.map((week, index) => (
                  <Line
                    key={`${week.key}-grid`}
                    x1={index * WEEK_WIDTH}
                    y1={0}
                    x2={index * WEEK_WIDTH}
                    y2={lineChartHeight - 30}
                    stroke="#22313D"
                  />
                ))}
                {points.length > 0 ? (
                  <>
                    <Path d={createCurvePath(points)} stroke={metricColor} strokeWidth={3} fill="none" />
                    {points.map((point, index) => (
                      <Circle key={`${block.id}-point-${index}`} cx={point.x} cy={point.y} r={4.5} fill={metricColor} />
                    ))}
                  </>
                ) : null}
              </Svg>
              <View style={[styles.weekAxisRow, { width: progressionWeeks.length * WEEK_WIDTH }]}>
                {progressionWeeks.map((week) => (
                  <View key={`${week.key}-axis`} style={styles.weekAxisItem}>
                    <Text style={styles.axisWeek}>{week.label}</Text>
                    <Text style={styles.axisDate}>{shortDate(week.start)}</Text>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>
          {points.length > 0 ? (
            <Text style={styles.analysisPointInfo}>
              {focusedWeek?.label ?? ''}: {formatScore(focusedValue)} <Text style={focusedDeltaColor}>({formatPct(focusedDeltaPct)})</Text>
            </Text>
          ) : null}
          {points.length === 0 ? <Text style={styles.analysisNoDataText}>Ingen träningsdata för valt filter ännu.</Text> : null}
          <Text style={styles.chartHelpText}>{helpTextByType(block)}</Text>
        </View>
        </View>
      </View>
    );
  };

  const renderMuscleGroupCard = (block: AnalysisBlock) => {
    const metric = block.muscleMetric ?? 'sets';
    const source = metric === 'sets' ? muscleGroupWeeklySets : muscleGroupWeeklyVolume;
    const values = weeks.map((week) => source.get(block.muscleGroupTag || '')?.get(week.key) || 0);
    const headerText = headerLabelByBlockId[block.id] ?? weeks[weeks.length - 1]?.headerLabel;
    return (
      <View key={block.id} style={styles.analysisBlockCard}>
        <View style={styles.analysisCardSurface}>
          <View style={styles.analysisBlockHeader}>
            <View style={styles.analysisBlockHeaderText}>
              <Text style={styles.analysisBlockTitle}>{blockTitle(block)}</Text>
              <Text style={styles.analysisBlockSubtitle}>{block.muscleGroupTag}</Text>
            </View>
            <Pressable onPress={() => removeBlock(block.id)} hitSlop={8} style={styles.analysisBlockRemove}>
              <MaterialCommunityIcons name="close" size={22} color="#9AAEC0" />
            </Pressable>
          </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.analysisMetricRow} contentContainerStyle={styles.analysisMetricRowContent}>
          {(['sets', 'volume'] as MuscleMetric[]).map((option) => {
            const active = metric === option;
            return (
              <Pressable
                key={option}
                style={[styles.chip, styles.analysisMetricChip, active && styles.chipActive]}
                onPress={() =>
                  setAnalysisBlocks((prev) => prev.map((item) => (
                    item.id === block.id ? { ...item, muscleMetric: option } : item
                  )))
                }
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{muscleMetricLabel(option)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Text style={styles.analysisRangeText}>{headerText}</Text>
        <View style={styles.analysisChartWrap}>
          <ScrollView
            horizontal
            ref={(ref: any) => { scrollRefsByBlockId.current[block.id] = ref; }}
            showsHorizontalScrollIndicator={false}
            onScroll={(event) => {
              const viewportW = event.nativeEvent.layoutMeasurement?.width ?? viewportWidth;
              const centerIndex = Math.round((event.nativeEvent.contentOffset.x + viewportW / 2) / WEEK_WIDTH);
              const week = weeks[Math.max(0, Math.min(weeks.length - 1, centerIndex))];
              setHeaderLabelByBlockId((prev) => ({ ...prev, [block.id]: week.headerLabel }));
            }}
            onLayout={(event) => {
              const width = event.nativeEvent.layout.width;
              const currentIndex = weeks.length - 1;
              const x = Math.max(currentIndex * WEEK_WIDTH - width / 2 + WEEK_WIDTH / 2, 0);
              setTimeout(() => scrollRefsByBlockId.current[block.id]?.scrollTo({ x, animated: false }), 50);
            }}
            scrollEventThrottle={16}
          >
            <View>
              <Svg width={weeks.length * WEEK_WIDTH} height={chartHeight}>
                {weeks.map((week, index) => (
                  <Line
                    key={`${week.key}-grid`}
                    x1={index * WEEK_WIDTH}
                    y1={0}
                    x2={index * WEEK_WIDTH}
                    y2={chartHeight - 30}
                    stroke="#22313D"
                  />
                ))}
                {renderWeeklyBarChart(values, '#81C784')}
              </Svg>
              <View style={styles.weekAxisRow}>
                {weeks.map((week) => (
                  <View key={`${week.key}-axis`} style={styles.weekAxisItem}>
                    <Text style={styles.axisWeek}>{week.label}</Text>
                    <Text style={styles.axisDate}>{shortDate(week.start)}</Text>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>
          <Text style={styles.chartHelpText}>{helpTextByType(block)}</Text>
          <View style={styles.chartLegend}>
            <View style={styles.chartLegendItem}>
              <View style={[styles.dot, { backgroundColor: '#81C784' }]} />
              <Text style={styles.chartLegendText}>{block.muscleGroupTag}</Text>
            </View>
          </View>
        </View>
        </View>
      </View>
    );
  };

  const distributionScopeLabel = (scope: DistributionScope) => {
    if (scope === 'primary') return 'Primär';
    if (scope === 'secondary') return 'Sekundär';
    return 'Primär+Sekundär';
  };

  const renderDistributionCard = (block: AnalysisBlock) => {
    const metric = block.distributionMetric ?? 'sets';
    const scope = block.distributionScope ?? 'both';
    const granularity = block.distributionGranularity ?? 'group';
    const isDetail = granularity === 'detail';
    const hSlices = isDetail ? hierarchySlices[scope][metric] : [];
    const flatSlices = isDetail ? [] : distributionSlices.group[scope][metric];
    const total = isDetail
      ? hSlices.reduce((sum, s) => sum + s.value, 0)
      : flatSlices.reduce((sum, s) => sum + s.value, 0);
    let angleCursor = 0;

    const pieSegments: { key: string; color: string; value: number }[] = [];
    if (isDetail) {
      hSlices.forEach((group) => {
        if (group.children.length > 0) {
          group.children.forEach((child) => pieSegments.push({ key: `${group.label}-${child.label}`, color: child.color, value: child.value }));
        } else {
          pieSegments.push({ key: group.label, color: group.color, value: group.value });
        }
      });
    } else {
      flatSlices.forEach((s) => pieSegments.push({ key: s.label, color: s.color, value: s.value }));
    }
    const groupPercentages = isDetail ? roundPercentagesToHundred(hSlices.map((group) => group.value), total) : [];
    const flatPercentages = isDetail ? [] : roundPercentagesToHundred(flatSlices.map((slice) => slice.value), total);

    return (
      <View key={block.id} style={styles.analysisBlockCard}>
        <View style={styles.analysisCardSurface}>
          <View style={styles.analysisBlockHeader}>
            <View style={styles.analysisBlockHeaderText}>
              <Text style={styles.analysisBlockTitle}>{blockTitle(block)}</Text>
              <Text style={styles.analysisBlockSubtitle}>Senaste {weeks.length} veckorna</Text>
            </View>
            <Pressable onPress={() => removeBlock(block.id)} hitSlop={8} style={styles.analysisBlockRemove}>
              <MaterialCommunityIcons name="close" size={22} color="#9AAEC0" />
            </Pressable>
          </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.analysisMetricRow} contentContainerStyle={styles.analysisMetricRowContent}>
          {(['sets', 'volume'] as DistributionMetric[]).map((option) => {
            const active = metric === option;
            return (
              <Pressable
                key={option}
                style={[styles.chip, styles.analysisMetricChip, active && styles.chipActive]}
                onPress={() =>
                  setAnalysisBlocks((prev) => prev.map((item) => (
                    item.id === block.id ? { ...item, distributionMetric: option } : item
                  )))
                }
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{muscleMetricLabel(option)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.analysisMetricRow} contentContainerStyle={styles.analysisMetricRowContent}>
          {(['primary', 'secondary', 'both'] as DistributionScope[]).map((option) => {
            const active = scope === option;
            return (
              <Pressable
                key={option}
                style={[styles.chip, styles.analysisMetricChip, active && styles.chipActive]}
                onPress={() =>
                  setAnalysisBlocks((prev) => prev.map((item) => (
                    item.id === block.id ? { ...item, distributionScope: option } : item
                  )))
                }
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{distributionScopeLabel(option)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.analysisMetricRow} contentContainerStyle={styles.analysisMetricRowContent}>
          {(['group', 'detail'] as DistributionGranularity[]).map((option) => {
            const active = granularity === option;
            return (
              <Pressable
                key={option}
                style={[styles.chip, styles.analysisMetricChip, active && styles.chipActive]}
                onPress={() =>
                  setAnalysisBlocks((prev) => prev.map((item) => (
                    item.id === block.id ? { ...item, distributionGranularity: option } : item
                  )))
                }
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{option === 'group' ? 'Kompakt' : 'Detaljerat'}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.analysisPieCard}>
          <Svg width={220} height={220}>
            {total > 0 ? (
              pieSegments.length === 1 ? (
                <Circle cx={110} cy={110} r={86} fill={pieSegments[0].color} />
              ) : (
                pieSegments.map((seg) => {
                  const segAngle = (seg.value / total) * 360;
                  const startAngle = angleCursor;
                  const endAngle = angleCursor + segAngle;
                  angleCursor = endAngle;
                  return (
                    <Path
                      key={seg.key}
                      d={describePieSlice(110, 110, 86, startAngle, endAngle)}
                      fill={seg.color}
                    />
                  );
                })
              )
            ) : null}
            {total > 0 ? <Circle cx={110} cy={110} r={34} fill="#151D26" /> : null}
          </Svg>
          {total === 0 ? <Text style={styles.analysisNoDataText}>Ingen data för fördelning ännu.</Text> : null}
          <Text style={styles.chartHelpText}>{helpTextByType(block)}</Text>
          <View style={styles.analysisPieLegend}>
            {isDetail ? hSlices.map((group, groupIndex) => (
              <View key={group.label}>
                <View style={styles.analysisPieLegendRow}>
                  <View style={styles.analysisPieLegendLabelWrap}>
                    <View style={[styles.dot, { backgroundColor: group.color }]} />
                    <Text style={styles.chartLegendText}>{group.label}</Text>
                  </View>
                  <Text style={styles.analysisPieLegendValue}>
                    {total > 0 ? `${groupPercentages[groupIndex] ?? 0}%` : '0%'}
                  </Text>
                </View>
                {group.children.map((child) => (
                  <View key={child.label} style={styles.hierarchyChildRow}>
                    <View style={styles.analysisPieLegendLabelWrap}>
                      <View style={[styles.dotSmall, { backgroundColor: child.color }]} />
                      <Text style={styles.hierarchyChildLabel}>{child.label}</Text>
                    </View>
                    <Text style={styles.hierarchyChildValue}>{child.pct}%</Text>
                  </View>
                ))}
              </View>
            )) : flatSlices.map((slice, sliceIndex) => (
              <View key={slice.label} style={styles.analysisPieLegendRow}>
                <View style={styles.analysisPieLegendLabelWrap}>
                  <View style={[styles.dot, { backgroundColor: slice.color }]} />
                  <Text style={styles.chartLegendText}>{slice.label}</Text>
                </View>
                <Text style={styles.analysisPieLegendValue}>
                  {total > 0 ? `${flatPercentages[sliceIndex] ?? 0}%` : '0%'}
                </Text>
              </View>
            ))}
          </View>
        </View>
        </View>
      </View>
    );
  };

  const progressionIntervalBlock = progressionIntervalTargetBlockId
    ? analysisBlocks.find((block) => block.id === progressionIntervalTargetBlockId && block.type === 'exerciseProgression')
    : undefined;
  const modalRepMin = Math.max(DEFAULT_REP_MIN, progressionIntervalBlock?.repMin ?? DEFAULT_REP_MIN);
  const modalRepMax = Math.max(modalRepMin, progressionIntervalBlock?.repMax ?? DEFAULT_REP_MAX);
  const modalWeightMin = Math.max(DEFAULT_WEIGHT_MIN, progressionIntervalBlock?.weightMin ?? DEFAULT_WEIGHT_MIN);
  const modalWeightMax = Math.max(modalWeightMin, progressionIntervalBlock?.weightMax ?? DEFAULT_WEIGHT_MAX);
  const modalLookbackWeeks = Math.max(
    MIN_LOOKBACK_WEEKS,
    Math.min(MAX_LOOKBACK_WEEKS, Math.round(progressionIntervalBlock?.lookbackWeeks ?? DEFAULT_LOOKBACK_WEEKS)),
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <RNScrollView style={{ flex: 1 }} contentContainerStyle={styles.analysisScrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.screenTitle}>Analys</Text>

        {visibleBlocks.length === 0 ? (
          <View style={styles.analysisEmptyCard}>
            <MaterialCommunityIcons name="chart-box-outline" size={42} color="#8FA1B3" />
            <Text style={styles.analysisEmptyTitle}>Inga analyser ännu</Text>
            <Text style={styles.analysisEmptyText}>Tryck på plusset för att lägga till en analys här.</Text>
          </View>
        ) : null}

        {visibleBlocks.map((block) => {
          if (block.type === 'rehabFrequency') return renderRehabCard(block);
          if (block.type === 'exerciseProgression') return renderProgressionIndexCard(block);
          if (block.type === 'muscleGroupBars') return renderMuscleGroupCard(block);
          return renderDistributionCard(block);
        })}
      </RNScrollView>

      <Modal visible={analysisPickerOpen} transparent animationType="fade" onRequestClose={() => setAnalysisPickerOpen(false)}>
        <View style={styles.timePickerBackdrop}>
          <View style={[styles.timePickerCard, styles.analysisModalCard]}>
            <View style={styles.analysisModalHeader}>
              <Text style={styles.timePickerTitle}>Lägg till analys</Text>
              <Pressable style={styles.analysisModalCloseButton} onPress={() => setAnalysisPickerOpen(false)}>
                <MaterialIcons name="close" size={20} color="#DCE4EC" />
              </Pressable>
            </View>
            <RNScrollView style={styles.analysisModalList} showsVerticalScrollIndicator={false}>
              <Pressable style={styles.analysisOptionCard} onPress={() => addBlock({ id: createBlockId(), type: 'rehabFrequency' })}>
                <Text style={styles.analysisOptionTitle}>Rehab-frekvens</Text>
                <Text style={styles.analysisOptionText}>Behåller stapeldiagrammet för dina dagliga övningar.</Text>
              </Pressable>
              <Pressable
                style={styles.analysisOptionCard}
                onPress={() => {
                  setAnalysisPickerOpen(false);
                  setProgressionPickerTargetBlockId(null);
                  setProgressionExercisePickerOpen(true);
                }}
              >
                <Text style={styles.analysisOptionTitle}>Progression - Styrka/Volym</Text>
                <Text style={styles.analysisOptionText}>Linjediagram med Brzycki-baserad TopsetScore och VolumeScore.</Text>
              </Pressable>
              <Pressable
                style={styles.analysisOptionCard}
                onPress={() => {
                  setAnalysisPickerOpen(false);
                  setMuscleGroupPickerOpen(true);
                }}
              >
                <Text style={styles.analysisOptionTitle}>Muskelgrupp</Text>
                <Text style={styles.analysisOptionText}>Veckovisa staplar för set eller volym per muskelgrupp.</Text>
              </Pressable>
              <Pressable style={styles.analysisOptionCard} onPress={() => addBlock({ id: createBlockId(), type: 'distributionPie', distributionMetric: 'sets', distributionScope: 'primary' })}>
                <Text style={styles.analysisOptionTitle}>Fördelning</Text>
                <Text style={styles.analysisOptionText}>Cirkeldiagram som visar andel set eller volym per muskelgrupp.</Text>
              </Pressable>
            </RNScrollView>
            <View style={styles.timePickerActions}>
              <Button onPress={() => setAnalysisPickerOpen(false)}>Stäng</Button>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={progressionExercisePickerOpen} transparent animationType="fade" onRequestClose={() => { setProgressionExercisePickerOpen(false); setProgressionPickerTargetBlockId(null); }}>
        <View style={styles.timePickerBackdrop}>
          <View style={[styles.timePickerCard, styles.analysisModalCard]}>
            <View style={styles.analysisModalHeader}>
              <Text style={styles.timePickerTitle}>Välj övning</Text>
              <Pressable style={styles.analysisModalCloseButton} onPress={() => { setProgressionExercisePickerOpen(false); setProgressionPickerTargetBlockId(null); }}>
                <MaterialIcons name="close" size={20} color="#DCE4EC" />
              </Pressable>
            </View>
            <RNScrollView style={styles.analysisModalList} showsVerticalScrollIndicator={false}>
              {progressionOptions.map((option) => (
                <Pressable
                  key={option.key}
                  style={styles.analysisOptionCard}
                  onPress={() => {
                    if (progressionPickerTargetBlockId) {
                      updateProgressionExercise(progressionPickerTargetBlockId, option.key);
                      return;
                    }
                    addBlock({
                      id: createBlockId(),
                      type: 'exerciseProgression',
                      exerciseKey: option.key,
                      progressScope: 'exercise',
                      progressMetric: 'topset',
                      progressGranularity: DEFAULT_PROGRESS_GRANULARITY,
                      progressTimeRange: DEFAULT_PROGRESS_TIME_RANGE,
                      repMin: DEFAULT_REP_MIN,
                      repMax: DEFAULT_REP_MAX,
                      weightMin: DEFAULT_WEIGHT_MIN,
                      weightMax: DEFAULT_WEIGHT_MAX,
                      lookbackWeeks: DEFAULT_LOOKBACK_WEEKS,
                    });
                  }}
                >
                  <Text style={styles.analysisOptionTitle}>{option.label}</Text>
                  <Text style={styles.analysisOptionText}>
                    {progressionPickerTargetBlockId ? 'Byt grafen till denna övning.' : 'Startar med Brzycki och fritt repintervall.'}
                  </Text>
                </Pressable>
              ))}
            </RNScrollView>
            <View style={styles.timePickerActions}>
              <Button onPress={() => { setProgressionExercisePickerOpen(false); setProgressionPickerTargetBlockId(null); }}>Stäng</Button>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={progressionInfoOpen} transparent animationType="fade" onRequestClose={() => setProgressionInfoOpen(false)}>
        <View style={styles.timePickerBackdrop}>
          <View style={[styles.timePickerCard, styles.analysisInfoModalCard]}>
            <View style={styles.analysisModalHeader}>
              <Text style={styles.timePickerTitle}>Progression</Text>
              <Pressable style={styles.analysisModalCloseButton} onPress={() => setProgressionInfoOpen(false)}>
                <MaterialIcons name="close" size={20} color="#DCE4EC" />
              </Pressable>
            </View>
            <View style={styles.analysisInfoContent}>
              <View style={styles.analysisInfoRow}>
                <Text style={styles.analysisInfoTitle}>Vad visar grafen?</Text>
                <Text style={styles.analysisInfoText}>Den visar hur styrka och volym ligger mot din normalnivå. Index 100 betyder normalnivå från senaste upp till 7 pass för valt val.</Text>
              </View>
              <View style={styles.analysisInfoRow}>
                <Text style={styles.analysisInfoTitle}>Färgerna</Text>
                <Text style={styles.analysisInfoText}>Blå linje är styrka. Grön linje är volym.</Text>
              </View>
              <View style={styles.analysisInfoRow}>
                <Text style={styles.analysisInfoTitle}>Streckad linje</Text>
                <Text style={styles.analysisInfoText}>Linjen är baseline 100 och baseras på senaste upp till 7 pass för valt val.</Text>
              </View>
              <View style={styles.analysisInfoRow}>
                <Text style={styles.analysisInfoTitle}>Dag, vecka, månad</Text>
                <Text style={styles.analysisInfoText}>Dag, vecka och månad styr grafens detaljnivå. 2v, 2m, 6m och Alla styr hur långt bak grafen visar och vilken period den procentuella förändringen jämför.</Text>
              </View>
              <View style={styles.analysisInfoRow}>
                <Text style={styles.analysisInfoTitle}>Brzycki</Text>
                <Text style={styles.analysisInfoText}>Brzycki gör vikt och reps till ett internt score. Det används bara för jämförelse, inte som ett riktigt 1RM.</Text>
              </View>
            </View>
            <View style={styles.timePickerActions}>
              <Button onPress={() => setProgressionInfoOpen(false)}>Stäng</Button>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={progressionScopePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => { setProgressionScopePickerOpen(false); setProgressionScopePickerTargetBlockId(null); }}
      >
        <View style={styles.timePickerBackdrop}>
          <View style={[styles.timePickerCard, styles.analysisModalCard]}>
            <View style={styles.analysisModalHeader}>
              <Text style={styles.timePickerTitle}>Välj primär muskel</Text>
              <Pressable style={styles.analysisModalCloseButton} onPress={() => { setProgressionScopePickerOpen(false); setProgressionScopePickerTargetBlockId(null); }}>
                <MaterialIcons name="close" size={20} color="#DCE4EC" />
              </Pressable>
            </View>
            <RNScrollView style={styles.analysisModalList} showsVerticalScrollIndicator={false}>
              {progressionPrimaryMuscleOptions.map((option) => (
                <Pressable
                  key={option.key}
                  style={styles.analysisOptionCard}
                  onPress={() => {
                    if (!progressionScopePickerTargetBlockId) return;
                    updateProgressionScopeTarget(progressionScopePickerTargetBlockId, option.key);
                  }}
                >
                  <Text style={styles.analysisOptionTitle}>{option.label}</Text>
                  <Text style={styles.analysisOptionText}>Byt progressionen till detta val.</Text>
                </Pressable>
              ))}
            </RNScrollView>
            <View style={styles.timePickerActions}>
              <Button onPress={() => { setProgressionScopePickerOpen(false); setProgressionScopePickerTargetBlockId(null); }}>Stäng</Button>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={progressionIntervalModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => { setProgressionIntervalModalOpen(false); setProgressionIntervalTargetBlockId(null); }}
      >
        <View style={styles.timePickerBackdrop}>
          <View style={[styles.timePickerCard, styles.analysisModalCard]}>
            <View style={styles.analysisModalHeader}>
              <Text style={styles.timePickerTitle}>
                {progressionIntervalModalType === 'reps'
                  ? 'Reps-intervall'
                  : progressionIntervalModalType === 'weight'
                    ? 'Vikt-intervall'
                    : 'Tid-intervall'}
              </Text>
              <Pressable
                style={styles.analysisModalCloseButton}
                onPress={() => { setProgressionIntervalModalOpen(false); setProgressionIntervalTargetBlockId(null); }}
              >
                <MaterialIcons name="close" size={20} color="#DCE4EC" />
              </Pressable>
            </View>
            {progressionIntervalModalType === 'reps' ? (
              <View style={styles.analysisModalIntervalSection}>
                <Text style={styles.analysisIntervalLabel}>Rep-range</Text>
                <View style={styles.analysisIntervalRow}>
                  <TextInput
                    value={String(modalRepMin)}
                    onChangeText={(text) => {
                      const parsed = Number.parseInt(text, 10);
                      if (!Number.isFinite(parsed)) return;
                      const nextMin = Math.max(DEFAULT_REP_MIN, parsed);
                      setAnalysisBlocks((prev) => prev.map((item) => (
                        item.id === progressionIntervalTargetBlockId ? { ...item, repMin: nextMin, repMax: Math.max(nextMin, modalRepMax) } : item
                      )));
                    }}
                    keyboardType="number-pad"
                    style={styles.analysisIntervalInput}
                    placeholderTextColor="#6F8497"
                  />
                  <MaterialIcons name="arrow-forward" size={18} color="#89A6C0" />
                  <TextInput
                    value={String(modalRepMax)}
                    onChangeText={(text) => {
                      const parsed = Number.parseInt(text, 10);
                      if (!Number.isFinite(parsed)) return;
                      const nextMax = Math.max(modalRepMin, parsed);
                      setAnalysisBlocks((prev) => prev.map((item) => (
                        item.id === progressionIntervalTargetBlockId ? { ...item, repMax: nextMax } : item
                      )));
                    }}
                    keyboardType="number-pad"
                    style={styles.analysisIntervalInput}
                    placeholderTextColor="#6F8497"
                  />
                </View>
              </View>
            ) : null}
            {progressionIntervalModalType === 'weight' ? (
              <View style={styles.analysisModalIntervalSection}>
                <Text style={styles.analysisIntervalLabel}>Vikt (kg)</Text>
                <View style={styles.analysisIntervalRow}>
                  <TextInput
                    value={String(modalWeightMin)}
                    onChangeText={(text) => {
                      const parsed = Number(text.replace(',', '.'));
                      if (!Number.isFinite(parsed)) return;
                      const nextMin = Math.max(DEFAULT_WEIGHT_MIN, parsed);
                      setAnalysisBlocks((prev) => prev.map((item) => (
                        item.id === progressionIntervalTargetBlockId ? { ...item, weightMin: nextMin, weightMax: Math.max(nextMin, modalWeightMax) } : item
                      )));
                    }}
                    keyboardType="decimal-pad"
                    style={styles.analysisIntervalInput}
                    placeholderTextColor="#6F8497"
                  />
                  <MaterialIcons name="arrow-forward" size={18} color="#89A6C0" />
                  <TextInput
                    value={String(modalWeightMax)}
                    onChangeText={(text) => {
                      const parsed = Number(text.replace(',', '.'));
                      if (!Number.isFinite(parsed)) return;
                      const nextMax = Math.max(modalWeightMin, parsed);
                      setAnalysisBlocks((prev) => prev.map((item) => (
                        item.id === progressionIntervalTargetBlockId ? { ...item, weightMax: nextMax } : item
                      )));
                    }}
                    keyboardType="decimal-pad"
                    style={styles.analysisIntervalInput}
                    placeholderTextColor="#6F8497"
                  />
                </View>
              </View>
            ) : null}
            {progressionIntervalModalType === 'time' ? (
              <View style={styles.analysisModalIntervalSection}>
                <Text style={styles.analysisIntervalLabel}>Veckor tillbaka</Text>
                <View style={styles.analysisLookbackRow}>
                  <TextInput
                    value={String(modalLookbackWeeks)}
                    onChangeText={(text) => {
                      const parsed = Number.parseInt(text, 10);
                      if (!Number.isFinite(parsed)) return;
                      const nextWeeks = Math.max(MIN_LOOKBACK_WEEKS, Math.min(MAX_LOOKBACK_WEEKS, parsed));
                      setAnalysisBlocks((prev) => prev.map((item) => (
                        item.id === progressionIntervalTargetBlockId ? { ...item, lookbackWeeks: nextWeeks } : item
                      )));
                    }}
                    keyboardType="number-pad"
                    style={styles.analysisLookbackInput}
                    placeholderTextColor="#6F8497"
                  />
                  <Text style={styles.analysisLookbackHint}>veckor</Text>
                </View>
              </View>
            ) : null}
            <View style={styles.timePickerActions}>
              <Button onPress={() => { setProgressionIntervalModalOpen(false); setProgressionIntervalTargetBlockId(null); }}>Klar</Button>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={muscleGroupPickerOpen} transparent animationType="fade" onRequestClose={() => setMuscleGroupPickerOpen(false)}>
        <View style={styles.timePickerBackdrop}>
          <View style={[styles.timePickerCard, styles.analysisModalCard]}>
            <View style={styles.analysisModalHeader}>
              <Text style={styles.timePickerTitle}>Välj muskelgrupp</Text>
              <Pressable style={styles.analysisModalCloseButton} onPress={() => setMuscleGroupPickerOpen(false)}>
                <MaterialIcons name="close" size={20} color="#DCE4EC" />
              </Pressable>
            </View>
            <RNScrollView style={styles.analysisModalList} showsVerticalScrollIndicator={false}>
              {muscleGroupTags.map((tag) => (
                <Pressable
                  key={tag}
                  style={styles.analysisOptionCard}
                  onPress={() => addBlock({
                    id: createBlockId(),
                    type: 'muscleGroupBars',
                    muscleGroupTag: tag,
                    muscleMetric: 'sets',
                  })}
                >
                  <Text style={styles.analysisOptionTitle}>{tag}</Text>
                  <Text style={styles.analysisOptionText}>Startar med metricen set per vecka.</Text>
                </Pressable>
              ))}
            </RNScrollView>
            <View style={styles.timePickerActions}>
              <Button onPress={() => setMuscleGroupPickerOpen(false)}>Stäng</Button>
            </View>
          </View>
        </View>
      </Modal>
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
  onArchiveSeries,
}: {
  series: PainSeries[];
  setSeries: React.Dispatch<React.SetStateAction<PainSeries[]>>;
  onArchiveSeries: (series: PainSeries) => void;
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
  const diaryTitleScrollY = useRef(new Animated.Value(0)).current;
  const diaryTitleOpacity = diaryTitleScrollY.interpolate({
    inputRange: [0, TITLE_FADE_SCROLL_DISTANCE],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
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
      <View style={[styles.titleOverlay, { paddingTop: insets.top, paddingHorizontal: 16 }]}>
        <Animated.Text style={[styles.screenTitle, { opacity: diaryTitleOpacity }]}>Dagbok</Animated.Text>
      </View>
      <RNScrollView
        ref={diaryScrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={[styles.listContent, { paddingTop: TITLE_FADE_SCROLL_DISTANCE }]}
        scrollEnabled={!scrollLocked}
        nestedScrollEnabled
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: diaryTitleScrollY } } }],
          { useNativeDriver: false, listener: (e: any) => { diaryScrollY.current = e.nativeEvent.contentOffset.y; } },
        )}
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
                <Pressable
                  onPress={() => {
                    onArchiveSeries(item);
                    setSeries((prev) => prev.filter((s) => s.id !== item.id));
                  }}
                >
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
  const insets = useSafeAreaInsets();
  const [tabBarWidth, setTabBarWidth] = useState(0);
  const pillTranslateX = useRef(new Animated.Value(0)).current;
  const prevIndexRef = useRef(state.index);
  const workoutPulseAnim = useRef(new Animated.Value(0)).current;
  const tabItemCentersRef = useRef<number[]>([]);
  const tabBarBottom = Math.max(insets.bottom + 10, 28);

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
    const measuredCenter = tabItemCentersRef.current[index];
    if (typeof measuredCenter === 'number') return measuredCenter - TAB_PILL_WIDTH / 2;
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

  const handleTabItemLayout = useCallback((index: number, e: { nativeEvent: { layout: { x: number; width: number } } }) => {
    const { x, width } = e.nativeEvent.layout;
    if (width <= 0) return;
    const centerX = x + width / 2;
    const prevCenter = tabItemCentersRef.current[index];
    if (typeof prevCenter !== 'number' || Math.abs(prevCenter - centerX) > 0.5) {
      tabItemCentersRef.current[index] = centerX;
      if (index === state.index) {
        pillTranslateX.setValue(centerX - TAB_PILL_WIDTH / 2);
      }
    }
  }, [state.index, pillTranslateX]);

  return (
    <View style={[styles.floatingTabBarOuter, { bottom: tabBarBottom }]} pointerEvents="box-none">
      {Platform.OS === 'ios' ? (
        <View style={[styles.floatingTabBar, styles.iosBlurFallback]} onLayout={handleLayout}>
          <View style={styles.floatingTabBarGlassOverlay} pointerEvents="none" />
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
            const isTrainingTab = route.name === 'Träning';
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
                onLayout={(e) => handleTabItemLayout(index, e)}
                onPress={() => {
                  const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                  if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name as never);
                }}
                style={styles.floatingTabBarItem}
              >
                <View style={styles.floatingTabPill}>
                  {isTrainingTab && hasActiveWorkout ? (
                    <Animated.View
                      style={[
                        styles.workoutActiveRing,
                        styles.trainingTabOpticalOffset,
                        { opacity: workoutPulseAnim },
                      ]}
                      pointerEvents="none"
                    />
                  ) : null}
                  <View style={isTrainingTab ? styles.trainingTabOpticalOffset : undefined}>
                    <IconComponent name={iconName as never} size={24} color={iconColor} />
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <BlurView
          intensity={72}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={styles.floatingTabBar}
          onLayout={handleLayout}
        >
          <View style={styles.floatingTabBarGlassOverlay} pointerEvents="none" />
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
            const isTrainingTab = route.name === 'Träning';
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
                onLayout={(e) => handleTabItemLayout(index, e)}
                onPress={() => {
                  const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                  if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name as never);
                }}
                style={styles.floatingTabBarItem}
              >
                <View style={styles.floatingTabPill}>
                  {isTrainingTab && hasActiveWorkout ? (
                    <Animated.View
                      style={[
                        styles.workoutActiveRing,
                        styles.trainingTabOpticalOffset,
                        { opacity: workoutPulseAnim },
                      ]}
                      pointerEvents="none"
                    />
                  ) : null}
                  <View style={isTrainingTab ? styles.trainingTabOpticalOffset : undefined}>
                    <IconComponent name={iconName as never} size={24} color={iconColor} />
                  </View>
                </View>
              </Pressable>
            );
          })}
        </BlurView>
      )}
    </View>
  );
}

export default function App() {
  const [showIntroSplash, setShowIntroSplash] = useState(true);
  const nativeSplashHiddenRef = useRef(false);
  const [rootLayoutReady, setRootLayoutReady] = useState(false);
  const [handoffFrameReady, setHandoffFrameReady] = useState(false);
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
  const [gymCustomMuscleGroups, setGymCustomMuscleGroups] = useState<string[]>([]);
  const [rehabCustomMuscleGroups, setRehabCustomMuscleGroups] = useState<string[]>([]);
  const [analysisBlocks, setAnalysisBlocks] = useState<AnalysisBlock[]>([{ id: '1', type: 'rehabFrequency' }]);
  const [archivedPainSeries, setArchivedPainSeries] = useState<PainSeries[]>([]);
  const [archivedPainSeriesSelectionMode, setArchivedPainSeriesSelectionMode] = useState(false);
  const [selectedArchivedPainSeriesIds, setSelectedArchivedPainSeriesIds] = useState<string[]>([]);
  const [newSeriesDialog, setNewSeriesDialog] = useState(false);
  const [newSeriesName, setNewSeriesName] = useState('');
  const [libraryVisible, setLibraryVisible] = useState(false);
  const libraryModalRef = useRef<Modalize>(null);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryFilter, setLibraryFilter] = useState<string | null>(null);
  const [libraryPreviewExercise, setLibraryPreviewExercise] = useState<LibraryExercise | null>(null);
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
  const [expandedTimeIndex, setExpandedTimeIndex] = useState<number | null>(null);
  const [deleteDialogExercise, setDeleteDialogExercise] = useState<Exercise | null>(null);
  const [rehabCategoryEditorVisible, setRehabCategoryEditorVisible] = useState(false);
  const [rehabCategoryEditorExerciseId, setRehabCategoryEditorExerciseId] = useState<string | null>(null);
  const [rehabCategoryDraftPrimary, setRehabCategoryDraftPrimary] = useState('');
  const [rehabCategoryDraftPrimarySubs, setRehabCategoryDraftPrimarySubs] = useState<string[]>([]);
  const rehabSubSectionAnim = useRef(new Animated.Value(0)).current;
  const [rehabCategoryDraftSecondarySubs, setRehabCategoryDraftSecondarySubs] = useState<Record<string, string[]>>({});
  const [rehabCategoryDraftSecondary, setRehabCategoryDraftSecondary] = useState<string[]>([]);
  const [rehabCategoryCustomInput, setRehabCategoryCustomInput] = useState('');
  const [rehabRemoveTagConfirm, setRehabRemoveTagConfirm] = useState<{ tag: string; canRemove: boolean } | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const trainingFabActionRef = useRef<(() => void) | null>(null);
  const analysisPlusActionRef = useRef<(() => void) | null>(null);
  const timeRowsScrollRef = useRef<RNScrollView | null>(null);
  const previousWizardTimesCountRef = useRef(1);
  const [hasActiveWorkout, setHasActiveWorkout] = useState(false);
  const [libraryListAtTop, setLibraryListAtTop] = useState(true);
  const libraryListAtTopRef = useRef(true);
  const normalizeAnalysisBlock = useCallback((rawBlock: AnalysisBlock, index: number): AnalysisBlock => {
    const baseBlock: AnalysisBlock = {
      ...rawBlock,
      id: rawBlock?.id || `${Date.now()}-${index}`,
      type: rawBlock?.type ?? 'rehabFrequency',
    };
    if (baseBlock.type !== 'exerciseProgression') return baseBlock;

    const rawScope = (baseBlock as { progressScope?: string }).progressScope;
    const inferredScope: ProgressScope = rawScope === 'primaryMuscle' || rawScope === 'exercise'
      ? rawScope
      : (baseBlock.exerciseKey ? 'exercise' : baseBlock.primaryMuscleTag ? 'primaryMuscle' : 'exercise');
    const rawGranularity = (baseBlock as { progressGranularity?: string }).progressGranularity;
    const progressGranularity: ProgressGranularity = rawGranularity === 'day' || rawGranularity === 'week' || rawGranularity === 'month'
      ? rawGranularity
      : DEFAULT_PROGRESS_GRANULARITY;
    const rawTimeRange = (baseBlock as { progressTimeRange?: string }).progressTimeRange;
    const progressTimeRange: ProgressTimeRange = rawTimeRange === '2w' || rawTimeRange === '2m' || rawTimeRange === '6m' || rawTimeRange === 'all'
      ? rawTimeRange
      : DEFAULT_PROGRESS_TIME_RANGE;
    const repMin = Number.isFinite(baseBlock.repMin) ? Math.max(DEFAULT_REP_MIN, baseBlock.repMin as number) : DEFAULT_REP_MIN;
    const repMax = Number.isFinite(baseBlock.repMax) ? Math.max(repMin, baseBlock.repMax as number) : DEFAULT_REP_MAX;
    const weightMin = Number.isFinite(baseBlock.weightMin) ? Math.max(DEFAULT_WEIGHT_MIN, baseBlock.weightMin as number) : DEFAULT_WEIGHT_MIN;
    const weightMax = Number.isFinite(baseBlock.weightMax) ? Math.max(weightMin, baseBlock.weightMax as number) : DEFAULT_WEIGHT_MAX;
    const lookbackWeeks = Number.isFinite(baseBlock.lookbackWeeks)
      ? Math.max(MIN_LOOKBACK_WEEKS, Math.min(MAX_LOOKBACK_WEEKS, Math.round(baseBlock.lookbackWeeks as number)))
      : DEFAULT_LOOKBACK_WEEKS;

    return {
      ...baseBlock,
      progressScope: inferredScope,
      progressMetric: baseBlock.progressMetric ?? 'topset',
      progressGranularity,
      progressTimeRange,
      repMin,
      repMax,
      weightMin,
      weightMax,
      lookbackWeeks,
    };
  }, []);

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
          if (Array.isArray(parsed.archivedPainSeries)) {
            setArchivedPainSeries(
              parsed.archivedPainSeries.map((item) => ({
                ...item,
                entries: Array.isArray(item.entries) ? item.entries : [],
                draftNote: typeof item.draftNote === 'string' ? item.draftNote : '',
              })),
            );
          }
          if (Array.isArray(parsed.workoutPlans)) setWorkoutPlans(parsed.workoutPlans);
          if (Array.isArray(parsed.completedWorkouts)) setCompletedWorkouts(parsed.completedWorkouts);
          if (Array.isArray(parsed.exerciseWeightPbs)) setExerciseWeightPbs(parsed.exerciseWeightPbs);
          if (Array.isArray(parsed.rehabLibraryExercises)) {
            const defaultsById = new Map(LIBRARY_EXERCISES.map((exercise) => [exercise.id, exercise]));
            const normalized = parsed.rehabLibraryExercises
              .map((exercise) => normalizeLibraryExercise(exercise, defaultsById.get(exercise.id)))
              .filter((exercise): exercise is LibraryExercise => !!exercise);
            setRehabLibraryExercises(normalized.length > 0 ? normalized : LIBRARY_EXERCISES);
          }
          if (Array.isArray(parsed.gymLibraryExercises)) setGymLibraryExercises(mergeGymLibrary(parsed.gymLibraryExercises));
          if (Array.isArray(parsed.gymCustomMuscleGroups)) setGymCustomMuscleGroups(parsed.gymCustomMuscleGroups);
          if (Array.isArray(parsed.rehabCustomMuscleGroups)) setRehabCustomMuscleGroups(parsed.rehabCustomMuscleGroups);
          if (Array.isArray(parsed.analysisBlocks)) {
            setAnalysisBlocks(parsed.analysisBlocks.map((block, index) => normalizeAnalysisBlock(block, index)));
          }
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
  }, [normalizeAnalysisBlock]);

  useEffect(() => {
    if (!isHydrated) return;
    const payload: PersistedState = {
      exercises,
      logs,
      painSeries,
      archivedPainSeries,
      workoutPlans,
      completedWorkouts,
      exerciseWeightPbs,
      rehabLibraryExercises,
      gymLibraryExercises,
      gymCustomMuscleGroups,
      rehabCustomMuscleGroups,
      analysisBlocks,
    };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch(() => {
      // Ignore temporary storage failures.
    });
  }, [exercises, logs, painSeries, archivedPainSeries, workoutPlans, completedWorkouts, exerciseWeightPbs, rehabLibraryExercises, gymLibraryExercises, gymCustomMuscleGroups, rehabCustomMuscleGroups, analysisBlocks, isHydrated]);

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
        const rawDaysLabel = ((raw.dl || raw.daysLabel || 'Varje dag') as string).trim();
        return {
          id: `ex_${makeId()}`,
          title: (raw.t || raw.title || '') as string,
          description: (raw.d || raw.description || '') as string,
          color: (raw.c || raw.color || '#5E81AC') as string,
          daysLabel: isEveryDayLabel(rawDaysLabel) ? 'Varje dag' : rawDaysLabel,
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

      function ensurePlanExercisesInLibrary(plan: WorkoutPlan) {
        const libList = gymLibraryExercisesRef.current;
        const byId = new Map(libList.map((e) => [e.id, e]));
        const byName = new Map(libList.map((e) => [e.name.trim().toLowerCase(), e]));
        const toAdd: LibraryExercise[] = [];
        plan.exercises.forEach((ex) => {
          if (ex.libraryExerciseId && byId.has(ex.libraryExerciseId)) return;
          if (byName.has(ex.name.trim().toLowerCase())) {
            if (!ex.libraryExerciseId) {
              const found = byName.get(ex.name.trim().toLowerCase())!;
              ex.libraryExerciseId = found.id;
            }
            return;
          }
          const newId = ex.libraryExerciseId || `gym-import-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          ex.libraryExerciseId = newId;
          toAdd.push({ id: newId, name: ex.name, tags: [], primaryMuscle: '', secondaryMuscles: [] });
          byId.set(newId, toAdd[toAdd.length - 1]);
          byName.set(ex.name.trim().toLowerCase(), toAdd[toAdd.length - 1]);
        });
        if (toAdd.length > 0) {
          setGymLibraryExercises((prev) => [...prev, ...toAdd]);
        }
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
              onPress: () => {
                ensurePlanExercisesInLibrary(plan);
                setWorkoutPlans((prev) => {
                  const idx = prev.findIndex((p) => p.id === plan.id);
                  if (idx >= 0) return prev.map((p) => (p.id === plan.id ? plan : p));
                  return [...prev, plan];
                });
              },
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
              onPress: () => {
                imported.forEach(ensurePlanExercisesInLibrary);
                setWorkoutPlans((prev) => {
                  const merged = [...prev];
                  for (const plan of imported) {
                    const idx = merged.findIndex((p) => p.id === plan.id);
                    if (idx >= 0) merged[idx] = plan;
                    else merged.push(plan);
                  }
                  return merged;
                });
              },
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

  /* ── Notification: request platform notification permissions ── */
  useEffect(() => {
    (async () => {
      if (!Device.isDevice) return;
      if (Platform.OS === 'android') {
        await requestAndroidNotificationPermission();
        await ensureAndroidExactAlarmPermission();
        return;
      }
      if (Platform.OS === 'ios') {
        await requestIosNotificationPermission();
        await ensureIosNotificationCategoryConfigured();
      }
    })();
  }, []);

  /* ── Platform notifications: consume actions done while app was backgrounded ── */
  useEffect(() => {
    if (!isHydrated) return;
    (async () => {
      const pending = Platform.OS === 'android'
        ? await consumeAndroidPendingCompletions().catch(() => [])
        : await consumeIosPendingCompletions().catch(() => []);
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
        } else if (Platform.OS === 'ios') {
          const pending = await consumeIosPendingCompletions().catch(() => []);
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

  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const flushIosPending = async () => {
      const pending = await consumeIosPendingCompletions().catch(() => []);
      if (!Array.isArray(pending) || pending.length === 0) return;
      const incoming: ExerciseLog[] = pending
        .filter((row) => row?.exerciseId && row?.atIso)
        .map((row) => ({ exerciseId: row.exerciseId, atIso: row.atIso }));
      if (incoming.length === 0) return;
      setLogs((prev) => mergeLogs(prev, incoming));
    };

    const onResponse = async (response: Notifications.NotificationResponse) => {
      await handleIosNotificationResponse(response);
      await flushIosPending();
    };

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      onResponse(response).catch((error) => {
        console.warn('[notifications] iOS action handling failed:', error);
      });
    });

    (async () => {
      const lastResponse = await Notifications.getLastNotificationResponseAsync().catch(() => null);
      if (lastResponse) {
        await onResponse(lastResponse).catch((error) => {
          console.warn('[notifications] iOS initial action handling failed:', error);
        });
        await Notifications.clearLastNotificationResponseAsync().catch(() => {});
      }
    })();

    return () => subscription.remove();
  }, []);

  const setTrainingFabAction = useCallback((action: (() => void) | null) => {
    trainingFabActionRef.current = action;
  }, []);
  const openLibrarySheet = useCallback(() => {
    setRehabCategoryEditorVisible(false);
    setLibraryListAtTop(true);
    libraryListAtTopRef.current = true;
    setLibraryQuery('');
    setLibraryFilter(null);
    setLibraryVisible(true);
    requestAnimationFrame(() => {
      libraryModalRef.current?.open();
    });
  }, []);
  const onLibraryModalClosed = useCallback(() => {
    setLibraryVisible(false);
    setRehabCategoryEditorVisible(false);
    setLibraryPreviewExercise(null);
  }, []);
  const closeLibrarySheet = useCallback(() => {
    libraryModalRef.current?.close();
  }, []);
  const onLibraryListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const atTop = event.nativeEvent.contentOffset.y <= 4;
    libraryListAtTopRef.current = atTop;
    setLibraryListAtTop(atTop);
  }, []);
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
    setExpandedTimeIndex(null);
  };
  const startCreateWizard = (exercise: LibraryExercise) => {
    setWizardExercise(exercise);
    setWizardMode('create');
    setWizardExerciseId(null);
    setWizardStep(0);
    setWizardDays([]);
    setWizardSets('3');
    setWizardReps('10');
    setWizardWeight('');
    setWizardTimesPerDay('1');
    setWizardTimes(['09:00']);
    setExpandedTimeIndex(null);
  };
  const animateWizardTimeEditorLayout = useCallback(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
    LayoutAnimation.configureNext({
      duration: 340,
      create: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
      update: {
        type: LayoutAnimation.Types.easeInEaseOut,
      },
      delete: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
    });
  }, []);
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
    () => [...new Set([
      ...rehabLibraryExercises.flatMap((exercise) => {
        const muscles = [exercise.primaryMuscle, ...(exercise.secondaryMuscles ?? [])].filter(Boolean) as string[];
        return muscles.length > 0 ? muscles : exercise.tags.filter((tag) => tag !== 'Egen');
      }),
      ...rehabCustomMuscleGroups,
    ])].sort((a, b) => muscleGroupSortIndex(a) - muscleGroupSortIndex(b) || a.localeCompare(b, 'sv')),
    [rehabLibraryExercises, rehabCustomMuscleGroups],
  );
  const rehabMuscleChoicesForEditor = useMemo(() => {
    const customMuscles = [rehabCategoryDraftPrimary, ...rehabCategoryDraftSecondary].filter(
      (tag) => tag && !rehabBodyPartFilters.includes(tag) && tag !== 'Egen',
    );
    return [...new Set([...rehabBodyPartFilters, ...customMuscles])].sort((a, b) => muscleGroupSortIndex(a) - muscleGroupSortIndex(b) || a.localeCompare(b, 'sv'));
  }, [rehabBodyPartFilters, rehabCategoryDraftPrimary, rehabCategoryDraftSecondary]);
  const hasExactRehabMatch = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    if (query.length === 0) return true;
    return rehabLibraryExercises.some((exercise) => exercise.name.toLowerCase() === query);
  }, [rehabLibraryExercises, libraryQuery]);
  const addCustomRehabExercise = () => {
    const name = libraryQuery.trim();
    if (!name) return;
    const existing = rehabLibraryExercises.find((exercise) => exercise.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      setLibraryVisible(false);
      libraryModalRef.current?.close();
      startCreateWizard(existing);
      setLibraryQuery('');
      setLibraryFilter(null);
      return;
    }
    const nextExercise: LibraryExercise = {
      id: `rehab-custom-${Date.now()}`,
      name,
      tags: [],
      primaryMuscle: '',
      secondaryMuscles: [],
    };
    setRehabLibraryExercises((prev) => [nextExercise, ...prev]);
    openRehabCategoryEditor(nextExercise);
    setLibraryQuery('');
    setLibraryFilter(null);
  };
  const syncRehabDraftAfterRemove = (tag: string) => {
    if (rehabCategoryDraftPrimary === tag) { setRehabCategoryDraftPrimary(''); setRehabCategoryDraftPrimarySubs([]); }
    setRehabCategoryDraftPrimarySubs((prev) => prev.filter((s) => s !== tag));
    setRehabCategoryDraftSecondary((prev) => prev.filter((t) => t !== tag));
    setRehabCategoryDraftSecondarySubs((prev) => {
      const next = { ...prev };
      delete next[tag];
      Object.keys(next).forEach((k) => { next[k] = next[k].filter((s) => s !== tag); if (next[k].length === 0) delete next[k]; });
      return next;
    });
  };
  const removeRehabTag = (_exercise: LibraryExercise, tag: string) => {
    setRehabRemoveTagConfirm({ tag, canRemove: !BUILTIN_TAGS.has(tag) });
  };
  const confirmRemoveRehabTag = () => {
    if (!rehabRemoveTagConfirm?.canRemove) return;
    const tag = rehabRemoveTagConfirm.tag;
    setRehabRemoveTagConfirm(null);
    setRehabLibraryExercises((prev) => prev.map((e) => stripTagFromExercise(e, tag)));
    setRehabCustomMuscleGroups((prev) => prev.filter((g) => g !== tag));
    syncRehabDraftAfterRemove(tag);
  };
  const openRehabCategoryEditor = (exercise: LibraryExercise) => {
    setRehabCategoryEditorExerciseId(exercise.id);
    setRehabCategoryDraftPrimary(exercise.primaryMuscle ?? '');
    setRehabCategoryDraftPrimarySubs(exercise.primarySubMuscles ?? []);
    setRehabCategoryDraftSecondary(exercise.secondaryMuscles ?? []);
    setRehabCategoryDraftSecondarySubs(exercise.secondarySubMuscles ?? {});
    setRehabCategoryCustomInput('');
    rehabSubSectionAnim.setValue(exercise.primaryMuscle && MUSCLE_SUBGROUPS[exercise.primaryMuscle] ? 1 : 0);
    setRehabCategoryEditorVisible(true);
  };
  const closeRehabCategoryEditor = () => {
    setRehabCategoryEditorVisible(false);
  };
  const addRehabCustomCategory = () => {
    const next = normalizeCategoryTag(rehabCategoryCustomInput);
    if (!next || next === 'Egen') return;
    setRehabCustomMuscleGroups((prev) => prev.includes(next) ? prev : [...prev, next]);
    if (!rehabMuscleChoicesForEditor.includes(next)) {
      setRehabCategoryDraftSecondary((prev) => prev.includes(next) ? prev : [...prev, next]);
    }
    setRehabCategoryCustomInput('');
  };
  const saveRehabCategoryEditor = () => {
    if (!rehabCategoryEditorExerciseId) return;
    const primary = normalizeCategoryTag(rehabCategoryDraftPrimary);
    if (!primary) {
      Alert.alert('Primär muskelgrupp saknas', 'Du måste välja en primär muskelgrupp.');
      return;
    }
    const validPrimarySubs = MUSCLE_SUBGROUPS[primary];
    const finalPrimarySubs = validPrimarySubs ? rehabCategoryDraftPrimarySubs.filter((s) => validPrimarySubs.includes(s)) : [];
    const secondary = rehabCategoryDraftSecondary
      .map((tag) => normalizeCategoryTag(tag))
      .filter((tag) => tag && tag !== primary);
    const finalSecondarySubs: Record<string, string[]> = {};
    secondary.forEach((sec) => {
      const validSubs = MUSCLE_SUBGROUPS[sec];
      const drafted = rehabCategoryDraftSecondarySubs[sec];
      if (validSubs && drafted?.length) {
        const filtered = drafted.filter((s) => validSubs.includes(s));
        if (filtered.length) finalSecondarySubs[sec] = filtered;
      }
    });
    const tags = [...new Set([primary, ...secondary])];
    setRehabLibraryExercises((prev) =>
      prev.map((exercise) => (exercise.id === rehabCategoryEditorExerciseId
        ? { ...exercise, tags, primaryMuscle: primary, primarySubMuscles: finalPrimarySubs, secondaryMuscles: secondary, secondarySubMuscles: Object.keys(finalSecondarySubs).length > 0 ? finalSecondarySubs : undefined }
        : exercise)),
    );
    setRehabCategoryEditorVisible(false);
    setRehabCategoryEditorExerciseId(null);
    setRehabCategoryCustomInput('');
  };
  useEffect(() => {
    const count = Math.max(1, Math.min(12, Number.parseInt(wizardTimesPerDay, 10) || 1));
    setWizardTimes((prev) => {
      if (prev.length === count) return prev;
      if (prev.length > count) return prev.slice(0, count);
      const next = [...prev];
      while (next.length < count) next.push(addHoursWithSameDayCap(next[next.length - 1] || '09:00', 3));
      return next;
    });
  }, [wizardTimesPerDay]);
  useEffect(() => {
    if (expandedTimeIndex === null) return;
    if (expandedTimeIndex < wizardTimes.length) return;
    setExpandedTimeIndex(null);
  }, [expandedTimeIndex, wizardTimes.length]);
  useEffect(() => {
    const previousCount = previousWizardTimesCountRef.current;
    const hasAddedTime = wizardStep === 2 && wizardTimes.length > previousCount;
    if (hasAddedTime) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          timeRowsScrollRef.current?.scrollToEnd({ animated: true });
        });
      });
    }
    previousWizardTimesCountRef.current = wizardTimes.length;
  }, [wizardStep, wizardTimes.length]);
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
    const primaryMuscle = fromLibrary?.primaryMuscle ?? (tags.length > 0 ? tags[0] : '');
    const secondaryMuscles = fromLibrary?.secondaryMuscles ?? tags.slice(1);
    setWizardExercise({
      id: fromLibrary?.id || `edit-${exercise.id}`,
      name: exercise.title,
      tags: tags.length > 0 ? tags : ['Rehab'],
      primaryMuscle,
      primarySubMuscles: fromLibrary?.primarySubMuscles,
      secondaryMuscles,
      secondarySubMuscles: fromLibrary?.secondarySubMuscles,
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
    setExpandedTimeIndex(null);
  };
  const normalizePainSeriesName = useCallback((value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('sv-SE'), []);
  const archivePainSeries = useCallback((removedSeries: PainSeries) => {
    const normalizedName = normalizePainSeriesName(removedSeries.name);
    if (!normalizedName) return;
    setArchivedPainSeries((prev) => {
      const withoutSameName = prev.filter((item) => normalizePainSeriesName(item.name) !== normalizedName);
      return [{ ...removedSeries, draftNote: '' }, ...withoutSameName];
    });
  }, [normalizePainSeriesName]);
  const addPainSeries = useCallback((rawName: string, archivedItem?: PainSeries) => {
    const name = rawName.trim().replace(/\s+/g, ' ');
    if (!name) return;
    const normalizedName = normalizePainSeriesName(name);
    const exists = painSeries.some((item) => normalizePainSeriesName(item.name) === normalizedName);
    if (exists) {
      Alert.alert('Område finns redan', `"${name}" finns redan i dagboken.`);
      return;
    }
    if (archivedItem) {
      setPainSeries((prev) => [...prev, { ...archivedItem, id: `${Date.now()}-${Math.random()}`, name }]);
      setArchivedPainSeries((prev) => prev.filter((item) => normalizePainSeriesName(item.name) !== normalizedName));
      setSelectedArchivedPainSeriesIds((prev) => {
        const next = prev.filter((id) => id !== archivedItem.id);
        if (next.length === 0) setArchivedPainSeriesSelectionMode(false);
        return next;
      });
    } else {
      setPainSeries((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, name, value: 5, draftNote: '', entries: [] }]);
    }
    setNewSeriesName('');
    setNewSeriesDialog(false);
  }, [painSeries, normalizePainSeriesName]);
  const addNewPainSeriesFromInput = useCallback(() => {
    const normalizedName = normalizePainSeriesName(newSeriesName);
    if (!normalizedName) return;
    const archivedMatch = archivedPainSeries.find((item) => normalizePainSeriesName(item.name) === normalizedName);
    addPainSeries(newSeriesName, archivedMatch);
  }, [addPainSeries, archivedPainSeries, newSeriesName, normalizePainSeriesName]);
  const activateArchivedPainSeriesSelection = useCallback((seriesId: string) => {
    setArchivedPainSeriesSelectionMode(true);
    setSelectedArchivedPainSeriesIds((prev) => (prev.includes(seriesId) ? prev : [...prev, seriesId]));
  }, []);
  const toggleArchivedPainSeriesSelection = useCallback((seriesId: string) => {
    setSelectedArchivedPainSeriesIds((prev) => {
      const next = prev.includes(seriesId) ? prev.filter((id) => id !== seriesId) : [...prev, seriesId];
      if (next.length === 0) setArchivedPainSeriesSelectionMode(false);
      return next;
    });
  }, []);
  const deleteSelectedArchivedPainSeries = useCallback(() => {
    if (selectedArchivedPainSeriesIds.length === 0) return;
    setArchivedPainSeries((prev) => prev.filter((item) => !selectedArchivedPainSeriesIds.includes(item.id)));
    setSelectedArchivedPainSeriesIds([]);
    setArchivedPainSeriesSelectionMode(false);
  }, [selectedArchivedPainSeriesIds]);
  const closeNewSeriesModal = useCallback(() => {
    setNewSeriesDialog(false);
    setSelectedArchivedPainSeriesIds([]);
    setArchivedPainSeriesSelectionMode(false);
  }, []);
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
    if (activeTab === 'Analys') {
      analysisPlusActionRef.current?.();
      return;
    }
    if (activeTab === 'Dagbok') {
      setNewSeriesName('');
      setSelectedArchivedPainSeriesIds([]);
      setArchivedPainSeriesSelectionMode(false);
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
  const handleRootLayout = useCallback(() => {
    setRootLayoutReady(true);
  }, []);
  const handleHandoffFrameReady = useCallback(() => {
    setHandoffFrameReady(true);
  }, []);
  useEffect(() => {
    if (nativeSplashHiddenRef.current) return;
    if (!rootLayoutReady || !handoffFrameReady) return;
    nativeSplashHiddenRef.current = true;
    SplashScreen.hideAsync().catch(() => {});
  }, [handoffFrameReady, rootLayoutReady]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: APP_BG_COLOR }} onLayout={handleRootLayout}>
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
                      gymCustomMuscleGroups={gymCustomMuscleGroups}
                      setGymCustomMuscleGroups={setGymCustomMuscleGroups}
                      onFabActionChange={setTrainingFabAction}
                      onActiveSessionChange={setHasActiveWorkout}
                    />
                  </AnimatedTabScreen>
                )}
              </Tab.Screen>
              <Tab.Screen name="Analys" options={{ title: 'Analys' }}>
                {() => (
                  <AnimatedTabScreen>
                    <AnalysisScreen
                      exercises={exercises}
                      logs={logs}
                      analysisBlocks={analysisBlocks}
                      setAnalysisBlocks={setAnalysisBlocks}
                      completedWorkouts={completedWorkouts}
                      exerciseWeightPbs={exerciseWeightPbs}
                      workoutPlans={workoutPlans}
                      gymLibraryExercises={gymLibraryExercises}
                      onPlusActionChange={(action) => {
                        analysisPlusActionRef.current = action;
                      }}
                    />
                  </AnimatedTabScreen>
                )}
              </Tab.Screen>
              <Tab.Screen name="Dagbok" options={{ title: 'Dagbok' }}>
                {() => (
                  <AnimatedTabScreen>
                    <DiaryScreen series={painSeries} setSeries={setPainSeries} onArchiveSeries={archivePainSeries} />
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

        <Modalize
          ref={libraryModalRef}
          modalStyle={[styles.bottomSheet, styles.libraryBottomSheet, styles.modalizeBottomSheet]}
          handleStyle={styles.bottomSheetHandle}
          useNativeDriver
          withHandle={false}
          panGestureEnabled={libraryListAtTop}
          adjustToContentHeight={false}
          modalTopOffset={Math.round(Dimensions.get('window').height * 0.03)}
          threshold={LIBRARY_MODAL_CLOSE_THRESHOLD}
          velocity={LIBRARY_MODAL_CLOSE_VELOCITY}
          dragToss={LIBRARY_MODAL_DRAG_TOSS}
          closeAnimationConfig={LIBRARY_MODAL_CLOSE_ANIMATION_CONFIG}
          closeOnOverlayTap={false}
          onClosed={onLibraryModalClosed}
          flatListProps={{
            style: styles.libraryListScroll,
            data: filteredLibrary,
            keyExtractor: (exercise) => exercise.id,
            keyboardShouldPersistTaps: 'handled',
            showsVerticalScrollIndicator: false,
            onScroll: onLibraryListScroll,
            scrollEventThrottle: 16,
            bounces: true,
            overScrollMode: 'always',
            contentContainerStyle: styles.libraryList,
            ListHeaderComponent: (
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
                    <Button mode="contained" onPress={addCustomRehabExercise} contentStyle={styles.libraryItemButton} labelStyle={{ fontSize: 11 }}>
                      Lägg till
                    </Button>
                  </View>
                ) : null}
              </View>
            ),
            ListEmptyComponent: <Text style={styles.logEmpty}>Inga övningar matchar filtret.</Text>,
            renderItem: ({ item: exercise }) => (
              <View style={styles.libraryItem}>
                <Pressable style={styles.libraryItemTouchableMain} onPress={() => setLibraryPreviewExercise(exercise)}>
                  <Text style={styles.libraryName}>{exercise.name}</Text>
                  <View style={styles.libraryTagWrap}>
                    {exercise.tags.map((tag: string) => (
                      <View key={`${exercise.id}-${tag}`} style={styles.libraryTag}>
                        <Text style={styles.libraryTagText}>{tag}</Text>
                      </View>
                    ))}
                    {(exercise.primarySubMuscles ?? []).map((sub: string) => (
                      <View key={`${exercise.id}-psub-${sub}`} style={styles.libraryTagSub}>
                        <Text style={styles.libraryTagSubText}>{sub}</Text>
                      </View>
                    ))}
                    {Object.entries(exercise.secondarySubMuscles ?? {} as Record<string, string[]>).flatMap(([, subs]) =>
                      (subs as string[]).map((sub: string) => (
                        <View key={`${exercise.id}-ssub-${sub}`} style={styles.libraryTagSub}>
                          <Text style={styles.libraryTagSubText}>{sub}</Text>
                        </View>
                      )),
                    )}
                  </View>
                </Pressable>
                <Button
                  mode="contained"
                  onPress={() => {
                    setLibraryVisible(false);
                    libraryModalRef.current?.close();
                    startCreateWizard(exercise);
                  }}
                  contentStyle={styles.libraryItemButton}
                  labelStyle={{ fontSize: 11 }}
                >
                  Välj
                </Button>
              </View>
            ),
          }}
        />
        <ExercisePreviewModal
          exercise={libraryPreviewExercise}
          onClose={() => setLibraryPreviewExercise(null)}
          onEditCategory={openRehabCategoryEditor}
        />
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
                    placeholder="Ny muskelgrupp"
                    placeholderTextColor={PLACEHOLDER_COLOR}
                  />
                  <Button mode="contained" onPress={addRehabCustomCategory}>
                    Lägg till
                  </Button>
                </View>
                <ScrollView style={styles.categoryDialogList} contentContainerStyle={styles.categoryChipListContent}>
                  <Text style={styles.categorySectionLabel}>Primär muskelgrupp (obligatorisk)</Text>
                  <View style={styles.categoryChipSection}>
                    <View style={styles.chipWrap}>
                      {rehabMuscleChoicesForEditor.map((tag) => (
                        <Pressable
                          key={`rehab-primary-${tag}`}
                          style={[styles.chip, rehabCategoryDraftPrimary === tag && styles.chipActive]}
                          onPress={() => {
                            const next = rehabCategoryDraftPrimary === tag ? '' : tag;
                            const willHaveSubs = !!MUSCLE_SUBGROUPS[next];
                            rehabSubSectionAnim.setValue(willHaveSubs ? 0 : 1);
                            if (willHaveSubs) {
                              Animated.timing(rehabSubSectionAnim, { toValue: 1, duration: 220, useNativeDriver: false }).start();
                            }
                            setRehabCategoryDraftPrimary(next);
                            setRehabCategoryDraftPrimarySubs([]);
                          }}
                          onLongPress={() => {
                            if (!rehabCategoryEditorExerciseId) return;
                            const ex = rehabLibraryExercises.find((e) => e.id === rehabCategoryEditorExerciseId);
                            if (ex) removeRehabTag(ex, tag);
                          }}
                        >
                          <Text style={[styles.chipText, rehabCategoryDraftPrimary === tag && styles.chipTextActive]}>{tag}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {!!rehabCategoryDraftPrimary && !!MUSCLE_SUBGROUPS[rehabCategoryDraftPrimary] && (
                      <Animated.View style={[styles.inlineSubRow, { opacity: rehabSubSectionAnim }]}>
                        {MUSCLE_SUBGROUPS[rehabCategoryDraftPrimary].map((sub) => {
                          const subSel = rehabCategoryDraftPrimarySubs.includes(sub);
                          return (
                            <Pressable
                              key={sub}
                              style={[styles.chip, styles.inlineSubChip, subSel && styles.chipActive]}
                              onPress={() => setRehabCategoryDraftPrimarySubs((prev) =>
                                prev.includes(sub) ? prev.filter((s) => s !== sub) : [...prev, sub],
                              )}
                              onLongPress={() => {
                                if (!rehabCategoryEditorExerciseId) return;
                                const ex = rehabLibraryExercises.find((e) => e.id === rehabCategoryEditorExerciseId);
                                if (ex) removeRehabTag(ex, sub);
                              }}
                            >
                              <Text style={[styles.chipText, styles.inlineSubChipText, subSel && styles.chipTextActive]}>{sub}</Text>
                            </Pressable>
                          );
                        })}
                      </Animated.View>
                    )}
                  </View>
                  <Text style={styles.categorySectionLabel}>Sekundära muskelgrupper</Text>
                  <View style={styles.categoryChipSection}>
                    <View style={styles.chipWrap}>
                      {rehabMuscleChoicesForEditor.filter((tag) => tag !== rehabCategoryDraftPrimary).map((tag) => (
                        <Pressable
                          key={`rehab-secondary-${tag}`}
                          style={[styles.chip, rehabCategoryDraftSecondary.includes(tag) && styles.chipActive]}
                          onPress={() =>
                            setRehabCategoryDraftSecondary((prev) =>
                              prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag],
                            )
                          }
                          onLongPress={() => {
                            if (!rehabCategoryEditorExerciseId) return;
                            const ex = rehabLibraryExercises.find((e) => e.id === rehabCategoryEditorExerciseId);
                            if (ex) removeRehabTag(ex, tag);
                          }}
                        >
                          <Text style={[styles.chipText, rehabCategoryDraftSecondary.includes(tag) && styles.chipTextActive]}>{tag}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {rehabCategoryDraftSecondary.filter((tag) => !!MUSCLE_SUBGROUPS[tag]).map((tag) => (
                      <View key={`rehab-sec-subs-${tag}`} style={styles.inlineSubSection}>
                        <Text style={styles.inlineSubLabel}>{tag}</Text>
                        <View style={styles.inlineSubRow}>
                          {MUSCLE_SUBGROUPS[tag].map((sub) => {
                            const subSel = (rehabCategoryDraftSecondarySubs[tag] ?? []).includes(sub);
                            return (
                              <Pressable
                                key={sub}
                                style={[styles.chip, styles.inlineSubChip, subSel && styles.chipActive]}
                                onPress={() => setRehabCategoryDraftSecondarySubs((prev) => {
                                  const current = prev[tag] ?? [];
                                  const next = current.includes(sub) ? current.filter((s) => s !== sub) : [...current, sub];
                                  return { ...prev, [tag]: next };
                                })}
                                onLongPress={() => {
                                  if (!rehabCategoryEditorExerciseId) return;
                                  const ex = rehabLibraryExercises.find((e) => e.id === rehabCategoryEditorExerciseId);
                                  if (ex) removeRehabTag(ex, sub);
                                }}
                              >
                                <Text style={[styles.chipText, styles.inlineSubChipText, subSel && styles.chipTextActive]}>{sub}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
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

        <Modal visible={!!rehabRemoveTagConfirm} transparent animationType="fade" onRequestClose={() => setRehabRemoveTagConfirm(null)}>
          <View style={styles.timePickerBackdrop}>
            <View style={styles.timePickerCard}>
              <Text style={styles.timePickerTitle}>{rehabRemoveTagConfirm?.canRemove ? 'Ta bort kategori' : 'Kategori låst'}</Text>
              <Text style={styles.confirmBody}>
                {rehabRemoveTagConfirm?.canRemove
                  ? `"${rehabRemoveTagConfirm.tag}" tas bort från alla övningar.${'\n'}Det går inte att ångra.`
                  : `"${rehabRemoveTagConfirm?.tag ?? ''}" är en inbyggd kategori och kan inte tas bort permanent.`}
              </Text>
              <View style={styles.confirmActions}>
                <Button mode="outlined" textColor="#DCE4EC" onPress={() => setRehabRemoveTagConfirm(null)}>
                  {rehabRemoveTagConfirm?.canRemove ? 'Avbryt' : 'Stäng'}
                </Button>
                {rehabRemoveTagConfirm?.canRemove && (
                  <Button mode="contained" buttonColor="#EF5350" textColor="#fff" onPress={confirmRemoveRehabTag}>
                    Ta bort
                  </Button>
                )}
              </View>
            </View>
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
                <View style={[styles.wizardBlock, styles.wizardTimesBlock]}>
                  <Text style={styles.wizardSectionTitle}>3) Antal gånger per dag</Text>
                  <View>
                    <View style={styles.numberStepperRow}>
                      <Pressable
                        style={styles.stepperButton}
                        onPress={() =>
                          setWizardTimesPerDay((prev) =>
                            `${Math.max(1, Math.min(12, (Number.parseInt(prev, 10) || 1) - 1))}`,
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
                            `${Math.max(1, Math.min(12, (Number.parseInt(prev, 10) || 1) + 1))}`,
                          )
                        }
                      >
                        <Text style={styles.stepperButtonText}>+</Text>
                      </Pressable>
                    </View>
                  </View>
                  <RNScrollView
                    ref={timeRowsScrollRef}
                    style={styles.timeRowsScroll}
                    contentContainerStyle={styles.timeRowsWrap}
                    showsVerticalScrollIndicator={false}
                  >
                    {wizardTimes.map((time, index) => {
                      const displayTime = parseReminderTime(time)?.canonicalTime ?? '09:00';
                      const isExpanded = expandedTimeIndex === index;
                      return (
                        <View
                          key={`time-${index}`}
                          style={[styles.timeRowCard, isExpanded ? styles.timeRowCardExpanded : null]}
                        >
                          <Pressable
                            style={styles.timeRowHeaderPressable}
                            onPress={() => {
                              animateWizardTimeEditorLayout();
                              setExpandedTimeIndex((prev) => (prev === index ? null : index));
                            }}
                          >
                            <View style={styles.timeRowHeader}>
                              <Text style={styles.timeRowTitle}>{`Tid ${index + 1}`}</Text>
                              <Text style={styles.timeRowValue}>{displayTime}</Text>
                            </View>
                          </Pressable>
                          {isExpanded ? (
                            <View style={styles.timeInlineEditor}>
                              <View style={styles.timeInlineLabelsRow}>
                                <Text style={styles.timeInlineLabel}>Timme</Text>
                                <Text style={styles.timeInlineLabel}>Minut</Text>
                              </View>
                              <View style={styles.timeInlineControlsRow}>
                                <View style={styles.timeInlineControlBlock}>
                                  <Pressable
                                    style={styles.timeStepperButton}
                                    onPress={() =>
                                      setWizardTimes((prev) =>
                                        prev.map((entry, entryIndex) =>
                                          entryIndex === index ? shiftClockTime(entry, -1, 0) : entry,
                                        ),
                                      )
                                    }
                                  >
                                    <Text style={styles.stepperButtonText}>-</Text>
                                  </Pressable>
                                  <View style={styles.timeStepperValueBox}>
                                    <Text style={styles.stepperValueText}>{displayTime.slice(0, 2)}</Text>
                                  </View>
                                  <Pressable
                                    style={styles.timeStepperButton}
                                    onPress={() =>
                                      setWizardTimes((prev) =>
                                        prev.map((entry, entryIndex) =>
                                          entryIndex === index ? shiftClockTime(entry, 1, 0) : entry,
                                        ),
                                      )
                                    }
                                  >
                                    <Text style={styles.stepperButtonText}>+</Text>
                                  </Pressable>
                                </View>
                                <View style={styles.timeInlineControlBlock}>
                                  <Pressable
                                    style={styles.timeStepperButton}
                                    onPress={() =>
                                      setWizardTimes((prev) =>
                                        prev.map((entry, entryIndex) =>
                                          entryIndex === index ? shiftClockTime(entry, 0, -5) : entry,
                                        ),
                                      )
                                    }
                                  >
                                    <Text style={styles.stepperButtonText}>-</Text>
                                  </Pressable>
                                  <View style={styles.timeStepperValueBox}>
                                    <Text style={styles.stepperValueText}>{displayTime.slice(3, 5)}</Text>
                                  </View>
                                  <Pressable
                                    style={styles.timeStepperButton}
                                    onPress={() =>
                                      setWizardTimes((prev) =>
                                        prev.map((entry, entryIndex) =>
                                          entryIndex === index ? shiftClockTime(entry, 0, 5) : entry,
                                        ),
                                      )
                                    }
                                  >
                                    <Text style={styles.stepperButtonText}>+</Text>
                                  </Pressable>
                                </View>
                              </View>
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                  </RNScrollView>
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
                      const nextTimes = wizardTimes
                        .map((time) => parseReminderTime(time)?.canonicalTime ?? null)
                        .filter((time): time is string => !!time);
                      const nextExercisePatch = {
                        title: wizardExercise.name,
                        description: `Kroppsdelar: ${wizardExercise.tags.join(', ')}`,
                        sets,
                        reps,
                        weightKg: Number.isFinite(weight) && weight > 0 ? weight : undefined,
                        daysLabel,
                        times: nextTimes.length > 0 ? nextTimes : ['09:00'],
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

        </Portal>
        <Modal visible={newSeriesDialog} transparent animationType="fade" onRequestClose={closeNewSeriesModal}>
          <View style={styles.timePickerBackdrop}>
            <View style={[styles.timePickerCard, styles.analysisModalCard]}>
              <View style={styles.analysisModalHeader}>
                <Text style={styles.timePickerTitle}>Lägg till smärtområde</Text>
                <Pressable style={styles.analysisModalCloseButton} onPress={closeNewSeriesModal}>
                  <MaterialIcons name="close" size={20} color="#9AAEC0" />
                </Pressable>
              </View>
              <RNScrollView style={styles.analysisModalList} showsVerticalScrollIndicator={false}>
                <TextInput
                  value={newSeriesName}
                  onChangeText={setNewSeriesName}
                  style={styles.input}
                  placeholder="Ex. Höger axel"
                  placeholderTextColor={PLACEHOLDER_COLOR}
                />
                <View style={styles.diaryAreaModalActionRow}>
                  <Button mode="contained" onPress={addNewPainSeriesFromInput} disabled={!newSeriesName.trim()}>
                    Lägg till
                  </Button>
                </View>
                <Text style={styles.analysisOptionText}>Tidigare borttagna områden</Text>
                {archivedPainSeriesSelectionMode ? (
                  <View style={styles.archivedSeriesSelectionRow}>
                    <View style={styles.historySelectionActions}>
                      <Text style={styles.historySelectedCount}>{selectedArchivedPainSeriesIds.length}</Text>
                      <Pressable style={styles.historyTrashButton} onPress={deleteSelectedArchivedPainSeries}>
                        <MaterialIcons name="delete" size={22} color="#0F1419" />
                      </Pressable>
                    </View>
                  </View>
                ) : null}
                {archivedPainSeries.length === 0 ? <Text style={styles.analysisOptionText}>Inga sparade områden än så länge.</Text> : null}
                {archivedPainSeries.map((item) => (
                  <Pressable
                    key={`archived-${item.id}`}
                    style={[
                      styles.analysisOptionCard,
                      selectedArchivedPainSeriesIds.includes(item.id) && styles.historySelectedCard,
                    ]}
                    onLongPress={() => activateArchivedPainSeriesSelection(item.id)}
                    onPress={() => {
                      if (archivedPainSeriesSelectionMode) {
                        toggleArchivedPainSeriesSelection(item.id);
                        return;
                      }
                      addPainSeries(item.name, item);
                    }}
                  >
                    <Text style={styles.analysisOptionTitle}>{item.name}</Text>
                    <Text style={styles.analysisOptionText}>
                      {item.entries.length > 0 ? `${item.entries.length} sparade registreringar` : 'Inga registreringar'}
                    </Text>
                  </Pressable>
                ))}
              </RNScrollView>
              <View style={styles.timePickerActions}>
                <Button onPress={closeNewSeriesModal}>Stäng</Button>
              </View>
            </View>
          </View>
        </Modal>
      </PaperProvider>
      {showIntroSplash ? <IntroSplashOverlay onDone={() => setShowIntroSplash(false)} onHandoffFrameReady={handleHandoffFrameReady} /> : null}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  introOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    backgroundColor: '#0F1419',
    alignItems: 'center',
    justifyContent: 'center',
  },
  introInner: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  introBackdropBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0F1419',
  },
  introBackdropTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#06111E',
  },
  introRippleRing: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 2,
    borderColor: 'rgba(137, 202, 252, 0.55)',
    backgroundColor: 'transparent',
  },
  introRippleRingSoft: {
    borderColor: 'rgba(165, 221, 255, 0.42)',
  },
  introRippleRingFaint: {
    borderColor: 'rgba(192, 235, 255, 0.3)',
  },
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
    backgroundColor: 'rgba(21, 29, 38, 0.72)',
    borderRadius: 39,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(214, 235, 255, 0.12)',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
  },
  iosBlurFallback: {
    backgroundColor: 'rgba(21, 29, 38, 0.92)',
  },
  floatingTabBarGlassOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  floatingTabBarItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
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
  trainingTabOpticalOffset: {
    transform: [{ translateX: 1 }, { translateY: 1.5 }],
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
    backgroundColor: 'rgba(82, 153, 230, 0.34)',
    borderWidth: 1,
    borderColor: 'rgba(183, 221, 255, 0.18)',
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
  titleOverlay: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
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
  modalizeBottomSheet: {
    overflow: 'hidden',
    minHeight: undefined,
    maxHeight: undefined,
    borderBottomWidth: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  gymBottomSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 0,
  },
  libraryBottomSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 0,
  },
  // (gymAnimatedSheet removed – renderToHardwareTextureAndroid moved to prop)
  librarySheetContent: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 18 : 14,
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
    paddingTop: Platform.OS === 'ios' ? 18 : 14,
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
  bottomSheetTitle: { color: '#E3EAF2', fontSize: 21, fontWeight: '700' },
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 38,
    justifyContent: 'center',
    backgroundColor: '#1D2732',
    borderColor: '#5A6B7B',
  },
  gymFilterChipActive: { borderColor: '#5B9ECF' },
  subFilterArrow: { color: '#90B8D8', fontSize: 9, marginLeft: 4 },
  subFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 5,
  },
  subFilterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 32,
    backgroundColor: '#182430',
    borderColor: '#3A5570',
  },
  subFilterChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  chipActive: { backgroundColor: '#1B3855', borderColor: '#4D8FBF' },
  chipText: { color: '#E3EAF2', fontWeight: '600', lineHeight: 20, fontSize: 14 },
  gymFilterChipText: { color: '#F2F7FC', fontSize: 15, fontWeight: '700', lineHeight: 22 },
  gymFilterChipTextSmall: { color: '#F2F7FC', fontSize: 13, fontWeight: '700', lineHeight: 20 },
  chipTextActive: { color: '#CCE4FF' },
  libraryListScroll: { flex: 1 },
  libraryListGestureZone: { flex: 1 },
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
  libraryItemTouchableMain: { flex: 1, gap: 4, alignSelf: 'stretch', justifyContent: 'center' },
  libraryName: { color: '#E3EAF2', fontSize: 15, fontWeight: '700' },
  libraryTagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  libraryTag: { borderRadius: 999, backgroundColor: '#2B3A48', paddingHorizontal: 8, paddingVertical: 4 },
  libraryTagText: { color: '#D3E7F8', fontSize: 12, fontWeight: '700' },
  libraryTagSub: { borderRadius: 999, backgroundColor: '#1B3855', borderWidth: 1, borderColor: '#3A6A9B', paddingHorizontal: 8, paddingVertical: 3 },
  libraryTagSubText: { color: '#90C4F0', fontSize: 11, fontWeight: '600', fontStyle: 'italic' },
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
  wizardTimesBlock: { flex: 1 },
  timeRowsScroll: { marginTop: 8, flex: 1 },
  timeRowsWrap: { gap: 8, paddingBottom: 8 },
  timeRowCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#42515F',
    backgroundColor: '#1A222C',
    overflow: 'hidden',
  },
  timeRowCardExpanded: { borderColor: '#4D8FBF', backgroundColor: '#18344F' },
  timeRowHeaderPressable: { paddingHorizontal: 12, paddingVertical: 12 },
  timeRowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  timeRowTitle: { color: '#DCE4EC', fontSize: 14, fontWeight: '700' },
  timeRowValue: { color: '#CCE4FF', fontSize: 15, fontWeight: '700' },
  timeInlineEditor: {
    borderTopWidth: 1,
    borderTopColor: '#33414F',
    backgroundColor: '#121B25',
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
  },
  timeInlineLabelsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingHorizontal: 4 },
  timeInlineLabel: { flex: 1, color: '#A8BACB', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  timeInlineControlsRow: { flexDirection: 'row', gap: 11 },
  timeInlineControlBlock: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  timeStepperButton: {
    width: 36,
    height: 36,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#42515F',
    backgroundColor: '#1A222C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeStepperValueBox: {
    width: 50,
    minHeight: 36,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#33414F',
    backgroundColor: '#1A222C',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 0,
  },
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
  exercisePreviewCard: { width: '100%', maxWidth: 520, alignSelf: 'center', gap: 12 },
  exercisePreviewHeader: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 38 },
  exercisePreviewTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  exercisePreviewCloseButton: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E2A36',
  },
  exercisePreviewImageFrame: {
    width: '100%',
    aspectRatio: 1.5,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#182430',
    borderWidth: 1,
    borderColor: '#2B3A48',
  },
  exercisePreviewImage: { width: '100%', height: '100%' },
  exercisePreviewPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  exercisePreviewPlaceholderText: { color: '#A8BACB', fontSize: 14, fontWeight: '700' },
  exercisePreviewCategoryButton: { minHeight: 42 },
  confirmBody: { color: '#A8BACB', fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 12 },
  confirmActions: { marginTop: 8, flexDirection: 'row', justifyContent: 'center', gap: 16 },
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
  chartHelpText: { marginTop: 10, color: '#9AAEC0', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  chartLegend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, paddingHorizontal: 4, gap: 10 },
  chartLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chartLegendText: { fontSize: 12, color: '#9AAEC0', maxWidth: 120 },
  analysisBlockCard: { marginHorizontal: 12, marginBottom: 16 },
  analysisCardSurface: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#24313E',
    backgroundColor: '#151D26',
    paddingTop: 8,
    paddingBottom: 12,
  },
  analysisBlockHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 4 },
  analysisBlockHeaderText: { flex: 1, paddingRight: 12 },
  analysisBlockTitle: { fontSize: 21, fontWeight: '800', color: '#DCE4EC' },
  analysisBlockSubtitle: { marginTop: 4, color: '#8FA1B3', fontSize: 13, lineHeight: 18 },
  analysisPbJumpText: { marginTop: 5, color: '#C7D5E2', fontSize: 13, fontWeight: '700' },
  progressBadge: {
    marginTop: 3,
    marginRight: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  progressBadgePositive: { backgroundColor: '#123323', borderColor: '#2A6B4A' },
  progressBadgeNegative: { backgroundColor: '#321A1A', borderColor: '#6E3434' },
  progressBadgeNeutral: { backgroundColor: '#1F2A36', borderColor: '#3A4D60' },
  progressBadgeText: { color: '#DCE4EC', fontSize: 11, fontWeight: '700' },
  analysisBlockRemove: { padding: 4 },
  analysisBlockHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  analysisBlockIconButton: { padding: 4 },
  analysisScrollContent: { paddingBottom: 140 },
  analysisEmptyCard: {
    marginHorizontal: 12,
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#24313E',
    backgroundColor: '#151D26',
    paddingHorizontal: 18,
    paddingVertical: 28,
    alignItems: 'center',
    gap: 10,
  },
  analysisEmptyTitle: { color: '#E3EAF2', fontSize: 18, fontWeight: '700' },
  analysisEmptyText: { color: '#9AAEC0', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  analysisModalCard: { maxHeight: '72%', paddingTop: 10 },
  analysisInfoModalCard: { maxHeight: '78%', paddingTop: 10 },
  analysisModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  analysisModalCloseButton: { padding: 6, borderRadius: 999 },
  analysisModalList: { maxHeight: 420 },
  analysisInfoContent: { gap: 12, paddingHorizontal: 4, paddingBottom: 6 },
  analysisInfoRow: {
    borderWidth: 1,
    borderColor: '#273644',
    borderRadius: 10,
    backgroundColor: '#1A222C',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  analysisInfoTitle: { color: '#E3EAF2', fontSize: 14, fontWeight: '800', marginBottom: 4 },
  analysisInfoText: { color: '#A8BACB', fontSize: 13, lineHeight: 19 },
  analysisControlRow: { marginTop: 8, marginHorizontal: 14, alignItems: 'flex-start' },
  analysisMetricRow: { marginTop: 6, marginHorizontal: 12, flexGrow: 0 },
  analysisMetricRowContent: { gap: 8, paddingRight: 12 },
  analysisMetricChip: { paddingVertical: 8 },
  analysisModalIntervalSection: { marginTop: 4, marginHorizontal: 6, marginBottom: 8, gap: 8 },
  analysisIntervalWrap: { marginTop: 8, marginHorizontal: 14, gap: 6 },
  analysisIntervalLabel: { color: '#9FB2C4', fontSize: 12, fontWeight: '700' },
  analysisIntervalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  analysisIntervalInput: {
    flex: 1,
    minHeight: 38,
    borderWidth: 1,
    borderColor: '#314554',
    borderRadius: 10,
    backgroundColor: '#1A222C',
    color: '#E4EDF5',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  analysisLookbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  analysisLookbackInput: {
    width: 90,
    minHeight: 38,
    borderWidth: 1,
    borderColor: '#314554',
    borderRadius: 10,
    backgroundColor: '#1A222C',
    color: '#E4EDF5',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  analysisLookbackHint: { color: '#9FB2C4', fontSize: 13 },
  analysisCompactFiltersRow: { marginTop: 8, marginHorizontal: 12, flexDirection: 'row', gap: 6 },
  analysisIntervalButton: {
    flex: 1,
    minHeight: 36,
    borderWidth: 1,
    borderColor: '#3A5162',
    borderRadius: 999,
    backgroundColor: '#17222D',
    paddingHorizontal: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  analysisIntervalButtonText: { color: '#CFE0EF', fontSize: 12, fontWeight: '700' },
  analysisRangeText: { marginTop: 8, color: '#9AAEC0', fontSize: 12, textAlign: 'center' },
  analysisPointInfo: { marginTop: 8, color: '#D2DDE7', fontSize: 13, textAlign: 'center', fontWeight: '600' },
  deltaPositive: { color: '#7FD69C' },
  deltaNegative: { color: '#F28989' },
  deltaNeutral: { color: '#9AAEC0' },
  analysisNoDataText: { marginTop: 8, color: '#9AAEC0', fontSize: 13, textAlign: 'center' },
  analysisChartWrap: {
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#24313E',
    backgroundColor: '#121922',
    paddingVertical: 10,
  },
  progressionChartCanvas: { position: 'relative' },
  progressionPointOverlay: { position: 'absolute', left: 0, top: 0 },
  progressionPoint: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  weekAxisRow: { flexDirection: 'row', width: WEEK_WIDTH * 14 },
  weekAxisItem: { width: WEEK_WIDTH, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  progressionAxisRow: { height: 38, position: 'relative' },
  progressionAxisItem: { position: 'absolute', width: WEEK_WIDTH, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  analysisOptionCard: {
    borderWidth: 1,
    borderColor: '#273644',
    borderRadius: 12,
    backgroundColor: '#1A222C',
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
    gap: 4,
  },
  analysisOptionTitle: { color: '#E3EAF2', fontSize: 15, fontWeight: '700' },
  analysisOptionText: { color: '#9AAEC0', fontSize: 13, lineHeight: 18 },
  diaryAreaModalActionRow: { marginTop: 10, marginBottom: 12, alignItems: 'flex-end' },
  archivedSeriesSelectionRow: { marginTop: 8, marginBottom: 10, alignItems: 'flex-end' },
  analysisPieCard: {
    marginHorizontal: 12,
    marginTop: 8,
    backgroundColor: '#151D26',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#24313E',
    alignItems: 'center',
  },
  analysisPieLegend: { marginTop: 10, width: '100%', gap: 8 },
  analysisPieLegendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  analysisPieLegendLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  analysisPieLegendValue: { color: '#DCE4EC', fontSize: 13, fontWeight: '700' },
  hierarchyChildRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 24, gap: 8, marginTop: 1 },
  hierarchyChildLabel: { color: '#8FA8C0', fontSize: 12 },
  hierarchyChildValue: { color: '#8FA8C0', fontSize: 12, fontWeight: '600' },
  dotSmall: { width: 8, height: 8, borderRadius: 4 },
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
    overflow: 'hidden',
  },
  trainingHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  trainingHeaderActions: { flexDirection: 'row', gap: 12 },
  trainingTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  trainingTitlePressable: { flex: 1, minWidth: 0 },
  trainingHeaderMenuWrap: { position: 'relative' },
  trainingMiniMenuButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3F5263',
    backgroundColor: '#1A222C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionMenuDismissOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
  },
  sessionExerciseMenu: {
    position: 'absolute',
    top: 40,
    right: 0,
    width: 210,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2B3A48',
    backgroundColor: '#101821',
    paddingVertical: 6,
    zIndex: 200,
    elevation: 200,
  },
  sessionExerciseMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  sessionExerciseMenuText: { color: '#DCE4EC', fontSize: 14, fontWeight: '600' },
  sessionExerciseMenuTextDanger: { color: '#EF9A9A' },
  sessionMenuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sessionMenuCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2B3A48',
    backgroundColor: '#151D26',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  sessionMenuTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sessionMenuDivider: {
    height: 1,
    backgroundColor: '#2B3A48',
    marginVertical: 8,
    marginHorizontal: 12,
  },
  sessionDropdownBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  sessionDropdownMenu: {
    position: 'absolute',
    top: 100,
    right: 12,
    width: 200,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2B3A48',
    backgroundColor: '#151D26',
    paddingVertical: 6,
    zIndex: 101,
    elevation: 10,
  },
  sessionDropdownTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  sessionDropdownDivider: {
    height: 1,
    backgroundColor: '#2B3A48',
    marginVertical: 4,
  },
  sessionDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  sessionDropdownItemText: {
    color: '#DCE4EC',
    fontSize: 14,
    fontWeight: '600',
  },
  sessionInlineMenu: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 8,
  },
  sessionInlineMenuItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    minWidth: 72,
  },
  sessionInlineMenuIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionInlineMenuText: {
    color: '#DCE4EC',
    fontSize: 12,
    fontWeight: '600',
  },
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
  trainingPageHeader: {
    paddingHorizontal: 12,
    marginBottom: 0,
  },
  trainingPageToggleWrap: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginTop: 0,
    marginBottom: 2,
    backgroundColor: '#151D26',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#24313E',
    padding: 4,
    gap: 6,
  },
  trainingPageToggleChip: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1A222C',
  },
  trainingPageToggleChipActive: {
    backgroundColor: '#1B3855',
    borderWidth: 1,
    borderColor: '#4D8FBF',
  },
  trainingPageToggleText: { color: '#9CB0C1', fontWeight: '700', fontSize: 12 },
  trainingPageToggleTextActive: { color: '#D7ECFF' },
  trainingPageToggleHint: {
    color: '#8FA1B3',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 6,
  },
  trainingPagerViewport: {
    flex: 1,
    overflow: 'hidden',
  },
  trainingPagerTrack: {
    flex: 1,
    flexDirection: 'row',
  },
  outdoorHeader: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
  },
  outdoorHeaderSubtitle: {
    color: '#8FA1B3',
    fontSize: 13,
    marginTop: 4,
    paddingHorizontal: 16,
  },
  outdoorSportRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  outdoorSportChip: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#33414F',
    backgroundColor: '#1A222C',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  outdoorSportChipActive: {
    borderColor: '#4D8FBF',
    backgroundColor: '#1B3855',
  },
  outdoorSportChipText: { color: '#9CB0C1', fontWeight: '700' },
  outdoorSportChipTextActive: { color: '#D7ECFF' },
  outdoorMapCard: {
    marginHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#24313E',
    backgroundColor: '#101821',
    overflow: 'hidden',
    minHeight: 210,
  },
  outdoorMapCardActive: {
    marginHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#24313E',
    minHeight: 320,
  },
  outdoorMapPlaceholder: {
    minHeight: 210,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  outdoorMapPlaceholderTitle: { color: '#E3EAF2', fontSize: 16, fontWeight: '700' },
  outdoorMapPlaceholderText: { color: '#9CB0C1', textAlign: 'center', fontSize: 13 },
  outdoorMapLoading: {
    position: 'absolute',
    top: 10,
    right: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 20, 25, 0.85)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  outdoorMapLoadingText: { color: '#DCE4EC', fontSize: 12, fontWeight: '600' },
  prestartOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 12,
    elevation: 12,
  },
  prestartBlur: {
    ...StyleSheet.absoluteFillObject,
  },
  prestartContent: {
    minWidth: 140,
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(159, 190, 214, 0.45)',
    backgroundColor: 'rgba(7, 12, 18, 0.62)',
    paddingHorizontal: 22,
    paddingVertical: 18,
  },
  prestartIcon: {
    marginBottom: 6,
  },
  prestartRunnerWrap: {
    marginBottom: 2,
  },
  prestartCountText: {
    color: '#FFFFFF',
    fontSize: 46,
    fontWeight: '900',
    lineHeight: 52,
  },
  prestartLoadingText: {
    color: '#EAF4FF',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 2,
  },
  prestartHintText: {
    color: '#C8DBEC',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
    letterSpacing: 0.3,
  },
  outdoorStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  outdoorStatsGridOverlay: {
    paddingHorizontal: 0,
    marginTop: 0,
  },
  outdoorStatsGridOverlayWide: {
    flexWrap: 'nowrap',
  },
  outdoorStatCard: {
    width: '48%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#24313E',
    backgroundColor: '#151D26',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  outdoorStatCardOverlay: {
    backgroundColor: 'rgba(18, 28, 36, 0.76)',
    borderColor: 'rgba(132, 161, 184, 0.34)',
    paddingVertical: 8,
  },
  outdoorStatCardOverlayWide: {
    width: 'auto',
    flex: 1,
  },
  outdoorStatLabel: { color: '#8FA1B3', fontSize: 12, fontWeight: '600' },
  outdoorStatValue: { color: '#E3EAF2', fontSize: 16, fontWeight: '800', marginTop: 4 },
  outdoorMapStatsOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 84,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(126, 153, 174, 0.35)',
    backgroundColor: 'rgba(8, 12, 18, 0.68)',
    padding: 10,
  },
  outdoorMapControlsOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(126, 153, 174, 0.3)',
    backgroundColor: 'rgba(8, 12, 18, 0.72)',
    padding: 10,
  },
  outdoorActionRow: {
    paddingHorizontal: 12,
    marginTop: 10,
  },
  outdoorActionButton: {
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#24313E',
    backgroundColor: 'rgba(34, 99, 66, 0.9)',
  },
  outdoorActionButtonHalf: {
    flex: 1,
  },
  outdoorActionButtonStop: {
    backgroundColor: '#A94442',
    borderColor: '#C76C6A',
  },
  outdoorActionButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  outdoorScrollContent: {
    paddingTop: 10,
  },
  outdoorScrollContentActive: {
    paddingTop: 0,
  },
  outdoorDetailScrollContent: {
    paddingBottom: 120,
  },
  outdoorHistoryWrap: {
    paddingHorizontal: 12,
    marginTop: 6,
  },
  outdoorHistoryList: {
    gap: 8,
    paddingTop: 6,
  },
  outdoorHistorySection: {
    gap: 8,
  },
  outdoorHistoryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  outdoorHistoryHeaderTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  outdoorHistoryMonthsList: {
    gap: 8,
    paddingLeft: 12,
  },
  outdoorHistoryMonthCard: {
    backgroundColor: '#17202A',
  },
  outdoorHistoryRunsList: {
    gap: 8,
    paddingLeft: 12,
  },
  outdoorHistoryRunCard: {
    backgroundColor: '#19232E',
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
  trainingStatActions: { flexDirection: 'row', alignItems: 'center', marginTop: 0 },
  trainingStatInput: {
    minWidth: 48,
    height: 32,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#445361',
    backgroundColor: '#101821',
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 6,
    paddingVertical: 0,
  },
  trainingStatInputFocused: {
    borderColor: '#5B9BD5',
    backgroundColor: '#15202B',
  },
  trainingMeta: { color: '#A8BACB', fontSize: 13, marginTop: 2 },
  loggedSetList: { gap: 6, marginTop: 2 },
  loggedSetEmpty: { color: '#FFFFFF', fontSize: 13 },
  sessionMoveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#35526D',
    backgroundColor: '#162433',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  sessionMoveBannerTextWrap: { flex: 1, gap: 2 },
  sessionMoveBannerTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  sessionMoveBannerSubtitle: { color: '#AFC4D8', fontSize: 12 },
  sessionMoveDoneButton: {
    minHeight: 38,
    borderRadius: 10,
    backgroundColor: '#A5D6A7',
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionMoveDoneButtonText: { color: '#0F1419', fontSize: 14, fontWeight: '800' },
  loggedSetRow: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2C3A49',
    backgroundColor: '#16202B',
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 6,
  },
  loggedSetRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  loggedSetRowMain: { flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: 1, minWidth: 0 },
  loggedSetTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 12, minWidth: 42 },
  loggedSetMetrics: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  loggedSetMetricLabel: { color: '#FFFFFF', fontSize: 10, textTransform: 'uppercase' },
  loggedSetMetricValue: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  pbFeedbackBox: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3D8055',
    backgroundColor: '#1B3A2A',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  pbFeedbackTitle: { color: '#D7F7E2', fontWeight: '800', fontSize: 13 },
  pbFeedbackBoxInline: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3D8055',
    backgroundColor: '#1B3A2A',
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trainingBottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  trainingLastLogged: { color: '#8FA1B3', fontSize: 12 },
  trainingButtons: { flexDirection: 'row', gap: 8, marginTop: 12, justifyContent: 'flex-end', alignSelf: 'flex-end' },
  trainingCardCollapsed: { paddingVertical: 10, gap: 0 },
  trainingCardMenuOpen: { zIndex: 100, elevation: 100 },
  trainingCardDragging: {
    zIndex: 30,
    elevation: 30,
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  sessionMoveHandle: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3F5263',
    backgroundColor: '#1A222C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionMoveHandleActive: {
    borderColor: '#7FC8FF',
    backgroundColor: '#1B2A38',
  },
  sessionMoveHandleDisabled: {
    opacity: 0.45,
  },
  savedPlanHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
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
  categoryDialogList: { maxHeight: 520, marginTop: 10 },
  categoryChipListContent: { paddingVertical: 6, paddingBottom: 10 },
  categoryModalCard: { width: '100%', maxWidth: 420, alignSelf: 'center', minHeight: 620, maxHeight: '90%', paddingBottom: 12, zIndex: 2, elevation: 2 },
  categoryBackdropTapZone: { ...StyleSheet.absoluteFillObject, zIndex: 1 },
  categoryEditorOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.62)', justifyContent: 'center', paddingHorizontal: 18, zIndex: 10000, elevation: 10000 },
  categoryHintText: { color: '#9AAEC0', marginTop: 20, marginBottom: 2 },
  categorySectionLabel: { color: '#9AAEC0', fontSize: 13, fontWeight: '600', marginTop: 14, marginBottom: 6 },
  categoryChipSection: { marginBottom: 4, gap: 2 },
  inlineSubRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingLeft: 16, paddingVertical: 4 },
  inlineSubSection: { marginTop: 4 },
  inlineSubLabel: { color: '#7BA8CE', fontSize: 11, fontWeight: '600', paddingLeft: 16, marginBottom: 2 },
  inlineSubChip: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#182430', borderColor: '#3A5570' },
  inlineSubChipText: { fontSize: 12 },
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
