import { Alert, Platform } from 'react-native';
import * as Location from 'expo-location';

export async function ensureRunTrackingPermissions(): Promise<boolean> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) {
    const requested = await Location.requestForegroundPermissionsAsync();
    if (!requested.granted) {
      Alert.alert('Platstillstand kravs', 'Tillat plats for att kunna starta och spara rundan.');
      return false;
    }
  }

  // Re-request on iOS to encourage precise location if user previously chose reduced.
  if (Platform.OS === 'ios') await Location.requestForegroundPermissionsAsync();

  const bg = await Location.getBackgroundPermissionsAsync();
  if (!bg.granted) {
    const requestedBg = await Location.requestBackgroundPermissionsAsync();
    if (!requestedBg.granted) {
      Alert.alert(
        'Bakgrundsplatstillstand kravs',
        'Tillat bakgrundsplats for spårning nar appen ar i bakgrunden.',
      );
      return false;
    }
  }
  return true;
}
