# Web camera vision: look when asked

Start a web conversation, enable the camera using the camera button, and allow
browser access. A preview and camera status are shown. Ask something like
“Look at my camera. What do you see?” or “What color is this object?”
Turn the camera off using the same button. Screen sharing is hidden in this
release because the tool only reads camera tracks. Mobile is unchanged.

While the camera is enabled, video travels through LiveKit to the agent. Diana
is instructed to call `look_at_camera` only for a user-requested visual question;
merely enabling the camera is not a request. Tool selection is model-driven.
Each call opens a short-lived video stream, takes one fresh frame, and sends it
to OpenAI's `gpt-5.2-chat-latest` through the existing LiveKit Inference connection.
The image is resized to fit 1024 × 1024. Only the resulting description is added
to Diana's conversation; images are not added to the ongoing chat history.
The application does not write images to files, DynamoDB, S3, or recording storage.
Provider-side processing is subject to the providers' data policies.

The tool is enabled by a server-owned `vision: true` field in signed dispatch
metadata for the verified web Cognito client only. Auth, AWS permissions, and
cost allocation tags are unchanged; no new AWS resources or secrets are required.
The local unauthenticated development token route does not enable this feature.

A camera-off, missing-track, capture timeout, or analysis failure results in a
plain-language response instead of a fabricated observation. Turning off the
camera prevents new captures; it cannot recall a frame already sent for analysis.
Video streams close after each request, including failures and cancellation.
No frames are buffered between requests. This release interprets snapshots,
not continuous motion, uploaded videos, or recorded clips.

## Verification

Run `uv sync --locked` and `uv run pytest -q` in `agent`. The vision tests include
camera-off behavior, ignored screen sharing, stream cleanup, and a real image
inference check. A temporary LiveKit room carries synthetic video for the WebRTC
integration test and is deleted afterward. These integration tests use LiveKit
credentials and incur small inference/connection charges. No physical camera
is needed for them.

Run `npm run build && npm test` in `infra` and `npm run build:static` in `web`.
Deploy the CDK stack to publish the web UI, token Lambda, and updated agent image.
After deployment, verify browser permissions, the camera preview, a visual
question, camera-off behavior, and a normal conversation with a physical camera.
