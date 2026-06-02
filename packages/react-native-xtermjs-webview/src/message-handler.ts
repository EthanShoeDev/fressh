import { type BridgeInboundMessage } from './bridge';

export function parseXtermJsWebViewMessage(
	rawData: string,
): BridgeInboundMessage {
	return JSON.parse(rawData) as BridgeInboundMessage;
}
