import type { WebSocket } from 'ws';

// =============================================================================
// twilioMessages.ts — Pure helper functions for Twilio wire format
//
// These functions deal only with the Twilio-specific message shapes and XML.
// They have no side effects (except sendAudioToTwilio which writes to a socket)
// and are straightforward to unit test.
// =============================================================================

/**
 * Build the TwiML XML response for POST /incoming-call.
 *
 * Twilio calls this webhook when someone dials the number. We respond with
 * XML telling Twilio to open a WebSocket media stream to our server.
 *
 * @param host - The public hostname (e.g. "abc.ngrok.io")
 * @param mediaStreamPath - The WebSocket path (e.g. "/media-stream")
 */
export function buildTwiML(host: string, mediaStreamPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${host}${mediaStreamPath}"/>
  </Connect>
</Response>`;
}

/**
 * Build the JSON message that Twilio expects when we want to play audio
 * to the caller. Twilio reads the base64 mulaw payload and plays it.
 *
 * @param streamSid - Twilio's identifier for this call leg (from the start event)
 * @param base64Audio - Base64-encoded mulaw 8kHz audio
 */
export function buildTwilioMediaMessage(streamSid: string, base64Audio: string): string {
  return JSON.stringify({
    event: 'media',
    streamSid,
    media: { payload: base64Audio },
  });
}

/**
 * Write an audio chunk to the Twilio WebSocket to play it to the caller.
 * Silently no-ops if the socket is not open.
 *
 * @param socket - The open Twilio WebSocket connection
 * @param streamSid - Twilio's stream identifier for this call
 * @param base64Audio - Base64-encoded mulaw 8kHz audio chunk
 */
export function sendAudioToTwilio(socket: WebSocket, streamSid: string, base64Audio: string): void {
  if (socket.readyState === 1 /* WebSocket.OPEN */) {
    socket.send(buildTwilioMediaMessage(streamSid, base64Audio));
  }
}
