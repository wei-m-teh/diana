from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from livekit import rtc

from vision import CameraUnavailableError, CameraVision


def room_with_camera(muted=False, source=rtc.TrackSource.SOURCE_CAMERA):
    publication = SimpleNamespace(source=source, muted=muted, track=object())
    participant = SimpleNamespace(track_publications={"camera": publication})
    return SimpleNamespace(remote_participants={"user_test": participant}), publication


async def test_camera_off_does_not_analyze():
    room, _ = room_with_camera(muted=True)
    analyze = AsyncMock()
    with pytest.raises(CameraUnavailableError):
        await CameraVision(room, analyze=analyze).look("What is here?")
    analyze.assert_not_called()


async def test_screen_share_is_not_camera():
    room, _ = room_with_camera(source=rtc.TrackSource.SOURCE_SCREENSHARE)
    with pytest.raises(CameraUnavailableError):
        await CameraVision(room).look("Look")


async def test_captures_fresh_frame_and_closes_stream():
    room, publication = room_with_camera()
    frame = object()
    stream = SimpleNamespace(
        __anext__=AsyncMock(return_value=SimpleNamespace(frame=frame)),
        aclose=AsyncMock(),
    )
    analyze = AsyncMock(return_value="A red mug.")
    camera = CameraVision(
        room, analyze=analyze, stream_factory=lambda track, **kw: stream
    )
    assert await camera.look("What color?") == "A red mug."
    stream.aclose.assert_awaited_once()
    analyze.assert_awaited_once_with(frame, "What color?")
    publication.muted = True
    with pytest.raises(CameraUnavailableError):
        await camera.look("And now?")
    assert analyze.await_count == 1


async def test_camera_stopped_during_capture_discards_frame():
    room, publication = room_with_camera()

    async def frame():
        publication.muted = True
        return SimpleNamespace(frame=object())

    stream = SimpleNamespace(__anext__=frame, aclose=AsyncMock())
    analyze = AsyncMock()
    with pytest.raises(CameraUnavailableError):
        await CameraVision(
            room, analyze=analyze, stream_factory=lambda *a, **kw: stream
        ).look("Look")
    stream.aclose.assert_awaited_once()
    analyze.assert_not_called()


async def test_real_model_understands_image():
    from dotenv import load_dotenv

    from vision import describe_frame

    load_dotenv(".env.local")
    frame = rtc.VideoFrame(
        128, 128, rtc.VideoBufferType.RGBA, bytes([255, 0, 0, 255]) * (128 * 128)
    )
    answer = await describe_frame(
        frame, "What is the dominant color? Answer with the color name."
    )
    assert "red" in answer.lower()


async def test_no_frame_closes_stream():
    room, _ = room_with_camera()
    stream = SimpleNamespace(
        __anext__=AsyncMock(side_effect=StopAsyncIteration), aclose=AsyncMock()
    )
    with pytest.raises(CameraUnavailableError):
        await CameraVision(room, stream_factory=lambda *a, **kw: stream).look("Look")
    stream.aclose.assert_awaited_once()


async def test_livekit_camera_frame_delivery():
    """Exercise actual WebRTC capture using synthetic video, never a user's camera."""
    import asyncio
    import os
    from uuid import uuid4

    from dotenv import load_dotenv
    from livekit import api

    load_dotenv(".env.local")
    room_name = "vision-test-" + uuid4().hex

    def token(identity):
        return (
            api.AccessToken(
                os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"]
            )
            .with_identity(identity)
            .with_grants(api.VideoGrants(room_join=True, room=room_name))
            .to_jwt()
        )

    sender, receiver = rtc.Room(), rtc.Room()
    producer = None
    try:
        await receiver.connect(os.environ["LIVEKIT_URL"], token("vision-observer"))
        await sender.connect(os.environ["LIVEKIT_URL"], token("user_vision_test"))
        source = rtc.VideoSource(128, 128)
        track = rtc.LocalVideoTrack.create_video_track("synthetic-camera", source)
        await sender.local_participant.publish_track(
            track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_CAMERA)
        )

        async def produce():
            while True:
                source.capture_frame(
                    rtc.VideoFrame(
                        128,
                        128,
                        rtc.VideoBufferType.RGBA,
                        bytes([255, 0, 0, 255]) * (128 * 128),
                    )
                )
                await asyncio.sleep(0.1)

        producer = asyncio.create_task(produce())
        camera = CameraVision(receiver)
        for _ in range(100):
            try:
                camera.publication()
                break
            except CameraUnavailableError:
                await asyncio.sleep(0.1)
        answer = await camera.look("What is the dominant color?")
        assert "red" in answer.lower()
    finally:
        if producer:
            producer.cancel()
            await asyncio.gather(producer, return_exceptions=True)
        await sender.disconnect()
        await receiver.disconnect()
        async with api.LiveKitAPI() as client:
            await client.room.delete_room(api.DeleteRoomRequest(room=room_name))
