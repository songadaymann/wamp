import type { PerformanceProfile } from '../ui/deviceLayout';
import {
  getDevicePerformanceMode,
  type DevicePerformanceMode,
} from './devicePerformanceMode';

export type PerformancePolicyReason =
  | 'automatic-device-default'
  | 'automatic-device-reduced'
  | 'automatic-room-pressure'
  | 'user-battery-saver'
  | 'user-full-quality'
  | 'safety-device-profile'
  | 'safety-room-pressure';

export type PerformancePolicySource = 'automatic' | 'user' | 'safety';
export type TransitionUrgency = 'standard' | 'seam-critical';

export interface ResolvedPerformancePolicy {
  selectedMode: DevicePerformanceMode;
  visualDataProfile: PerformanceProfile;
  activeRuntimeProfile: PerformanceProfile;
  memoryProfile: PerformanceProfile;
  transitionUrgency: TransitionUrgency;
  reason: PerformancePolicyReason;
  source: PerformancePolicySource;
}

export interface ResolvePerformancePolicyInput {
  selectedMode: DevicePerformanceMode;
  deviceProfile: PerformanceProfile;
  localPlayPressure?: 'normal' | 'reduced';
  seamPreparationUrgent?: boolean;
}

export function resolvePerformancePolicy(
  input: ResolvePerformancePolicyInput,
): ResolvedPerformancePolicy {
  const roomPressureReduced = input.localPlayPressure === 'reduced';
  const transitionUrgency: TransitionUrgency = input.seamPreparationUrgent
    ? 'seam-critical'
    : 'standard';

  if (input.selectedMode === 'battery-saver') {
    return {
      selectedMode: input.selectedMode,
      visualDataProfile: 'reduced',
      activeRuntimeProfile: 'reduced',
      memoryProfile: input.deviceProfile,
      transitionUrgency,
      reason: 'user-battery-saver',
      source: 'user',
    };
  }

  if (input.selectedMode === 'full-quality') {
    const safetyConstrained = roomPressureReduced || input.deviceProfile === 'reduced';
    return {
      selectedMode: input.selectedMode,
      visualDataProfile: 'default',
      activeRuntimeProfile: roomPressureReduced ? 'reduced' : input.deviceProfile,
      memoryProfile: input.deviceProfile,
      transitionUrgency,
      reason: roomPressureReduced
        ? 'safety-room-pressure'
        : input.deviceProfile === 'reduced'
          ? 'safety-device-profile'
          : 'user-full-quality',
      source: safetyConstrained ? 'safety' : 'user',
    };
  }

  const autoReduced = input.deviceProfile === 'reduced' || roomPressureReduced;
  return {
    selectedMode: input.selectedMode,
    visualDataProfile: autoReduced ? 'reduced' : 'default',
    activeRuntimeProfile: autoReduced ? 'reduced' : 'default',
    memoryProfile: input.deviceProfile,
    transitionUrgency,
    reason: roomPressureReduced
      ? 'automatic-room-pressure'
      : input.deviceProfile === 'reduced'
        ? 'automatic-device-reduced'
        : 'automatic-device-default',
    source: 'automatic',
  };
}

export function getResolvedPerformancePolicy(
  deviceProfile: PerformanceProfile,
  context: Pick<ResolvePerformancePolicyInput, 'localPlayPressure' | 'seamPreparationUrgent'> = {},
): ResolvedPerformancePolicy {
  return resolvePerformancePolicy({
    selectedMode: getDevicePerformanceMode(),
    deviceProfile,
    ...context,
  });
}
