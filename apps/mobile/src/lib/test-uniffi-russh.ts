import {
	generateKeyPair,
	KeyType,
	uniffiInitAsync,
} from '@fressh/react-native-uniffi-russh';

void uniffiInitAsync().then(() => {
	void generateKeyPair(KeyType.Ed25519).then((keyPair) => {
		console.log('testKeyPair', keyPair);
	});
});

// // https://jhugman.github.io/uniffi-bindgen-react-native/idioms/common-types.html
// // https://jhugman.github.io/uniffi-bindgen-react-native/idioms/callback-interfaces.html
// // https://jhugman.github.io/uniffi-bindgen-react-native/idioms/async-callbacks.html

// const connectionDetailsSchema = z.object({
// 	host: z.string().min(1),
// 	port: z.number().min(1),
// 	username: z.string().min(1),
// 	security: z.discriminatedUnion('type', [
// 		z.object({
// 			type: z.literal('password'),
// 			password: z.string().min(1),
// 		}),
// 		z.object({
// 			type: z.literal('key'),
// 			keyId: z.string().min(1),
// 		}),
// 	]),
// });

// The ideal interface

// const connectionDetailsSchema = z.object({
// 	host: z.string().min(1),
// 	port: z.number().min(1),
// 	username: z.string().min(1),
// 	// There is a section on tagged enums: https://jhugman.github.io/uniffi-bindgen-react-native/idioms/enums.html#enums-with-properties
// 	security: z.discriminatedUnion('type', [
// 		z.object({
// 			type: z.literal('password'),
// 			password: z.string().min(1),
// 		}),
// 		z.object({
// 			type: z.literal('key'),
// 			keyId: z.string().min(1),
// 		}),
// 	]),
// });

// type ConnectionDetails = z.infer<typeof connectionDetailsSchema>;

// type SSHConnectionStatus =
// 	| 'tcp-connecting'
// 	| 'tcp-connected'
// 	| 'tcp-disconnected'
// 	| 'shell-connecting'
// 	| 'shell-connected'
// 	| 'shell-disconnected';

// type SSHConnection = {
// 	connectionDetails: ConnectionDetails;
// 	sessionId: string;
// 	createdAtMs: number;
// 	establishedAtMs: number;
// 	// I am not sure this is the best way to do this within uniffi.
// 	addListener: (listener: (data: ArrayBuffer) => void) => void;
// 	removeListener: (listener: (data: ArrayBuffer) => void) => void;

// 	// Also not sure if this is the best way
// 	sendData: (data: ArrayBuffer) => Promise<void>;
// 	disconnect: () => Promise<void>;
// };

// type SSHConnectParams = {
// 	connectionDetails: ConnectionDetails;
// 	onStatusChange: (status: SSHConnectionStatus) => void;
// };

// type RustInterface = {
// 	requestSshConnection: (params: SSHConnectParams) => Promise<SSHConnection>;
// 	generateKeyPair: (
// 		type: 'rsa' | 'ecdsa' | 'ed25519' | 'ed448',
// 	) => Promise<string>;
// };
