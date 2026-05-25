import { RnRussh } from '@fressh/react-native-uniffi-russh';
import { rootLogger } from './logger';
import { createSshRegistryStore } from './ssh-registry-store';

const logger = rootLogger.extend('SshStore');

export const useSshStore = createSshRegistryStore(RnRussh.connect, logger);
