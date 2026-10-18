'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Track } from 'livekit-client';
import { AnimatePresence, type MotionProps, motion } from 'motion/react';
import {
  VideoTrack,
  useLocalParticipant,
  useSessionContext,
  useSessionMessages,
  useVoiceAssistant,
} from '@livekit/components-react';
import { AgentAudioVisualizerBar } from '@/components/agents-ui/agent-audio-visualizer-bar';
import {
  AgentControlBar,
  type AgentControlBarControls,
} from '@/components/agents-ui/agent-control-bar';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Attachments } from '@/components/app/attachments';
import { useSearchSources } from '@/components/app/conversation-context';
import { ConversationResults } from '@/components/app/conversation-results';
import { useMedia } from '@/components/app/media';
import { cn } from '@/lib/shadcn/utils';
import { TileLayout, useLocalTrackRef } from './tile-view';

const MotionMessage = motion.create(Shimmer);

const BOTTOM_VIEW_MOTION_PROPS: MotionProps = {
  variants: {
    visible: {
      opacity: 1,
      translateY: '0%',
    },
    hidden: {
      opacity: 0,
      translateY: '100%',
    },
  },
  initial: 'hidden',
  animate: 'visible',
  exit: 'hidden',
  transition: {
    duration: 0.3,
    delay: 0.5,
    ease: 'easeOut',
  },
};

const SHIMMER_MOTION_PROPS: MotionProps = {
  variants: {
    visible: {
      opacity: 1,
      transition: {
        ease: 'easeIn',
        duration: 0.5,
        delay: 0.8,
      },
    },
    hidden: {
      opacity: 0,
      transition: {
        ease: 'easeIn',
        duration: 0.5,
        delay: 0,
      },
    },
  },
  initial: 'hidden',
  animate: 'visible',
  exit: 'hidden',
};

interface FadeProps {
  top?: boolean;
  bottom?: boolean;
  className?: string;
}

export function Fade({ top = false, bottom = false, className }: FadeProps) {
  return (
    <div
      className={cn(
        'from-background pointer-events-none h-4 bg-linear-to-b to-transparent',
        top && 'bg-linear-to-b',
        bottom && 'bg-linear-to-t',
        className
      )}
    />
  );
}

export interface AgentSessionView_01Props {
  /**
   * Message shown above the controls before the first chat message is sent.
   *
   * @default 'Agent is listening, ask it a question'
   */
  preConnectMessage?: string;
  /**
   * Enables or disables the chat toggle and transcript input controls.
   *
   * @default true
   */
  supportsChatInput?: boolean;
  /**
   * Enables or disables camera controls in the bottom control bar.
   *
   * @default true
   */
  supportsVideoInput?: boolean;
  /**
   * Enables or disables screen sharing controls in the bottom control bar.
   *
   * @default true
   */
  supportsScreenShare?: boolean;
  /**
   * Shows a pre-connect buffer state with a shimmer message before messages appear.
   *
   * @default true
   */
  isPreConnectBufferEnabled?: boolean;

  /** Selects the visualizer style rendered in the main tile area. */
  audioVisualizerType?: 'bar' | 'wave' | 'grid' | 'radial' | 'aura';
  /** Primary hex color used by supported audio visualizer variants. */
  audioVisualizerColor?: `#${string}`;
  /** Hue shift intensity used by certain visualizers. */
  audioVisualizerColorShift?: number;
  /** Number of bars to render when `audioVisualizerType` is `bar`. */
  audioVisualizerBarCount?: number;
  /** Number of rows in the visualizer when `audioVisualizerType` is `grid`. */
  audioVisualizerGridRowCount?: number;
  /** Number of columns in the visualizer when `audioVisualizerType` is `grid`. */
  audioVisualizerGridColumnCount?: number;
  /** Number of radial bars when `audioVisualizerType` is `radial`. */
  audioVisualizerRadialBarCount?: number;
  /** Base radius of the radial visualizer when `audioVisualizerType` is `radial`. */
  audioVisualizerRadialRadius?: number;
  /** Stroke width of the wave path when `audioVisualizerType` is `wave`. */
  audioVisualizerWaveLineWidth?: number;
  /** Optional class name merged onto the outer `<section>` container. */
  className?: string;
}

export function AgentSessionView_01({
  preConnectMessage = 'Agent is listening, ask it a question',
  supportsChatInput = true,
  supportsVideoInput = true,
  supportsScreenShare = true,
  isPreConnectBufferEnabled = true,

  audioVisualizerType,
  audioVisualizerColor,
  audioVisualizerColorShift,
  audioVisualizerBarCount,
  audioVisualizerGridRowCount,
  audioVisualizerGridColumnCount,
  audioVisualizerRadialBarCount,
  audioVisualizerRadialRadius,
  audioVisualizerWaveLineWidth,
  ref,
  className,
  ...props
}: React.ComponentProps<'section'> & AgentSessionView_01Props) {
  const session = useSessionContext();
  const { isCameraEnabled } = useLocalParticipant();
  const cameraTrack = useLocalTrackRef(Track.Source.Camera);
  const [deviceError, setDeviceError] = useState(false);
  // LiveKit keys device-list subscriptions on this callback. Keep it stable
  // while streaming transcripts update the session view.
  const handleDeviceError = useCallback(() => setDeviceError(true), []);
  const { messages } = useSessionMessages(session);
  const [chatOpen, setChatOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const toggleTranscript = useCallback((open: boolean) => {
    setTranscriptOpen(open);
    if (open) setChatOpen(true);
  }, []);
  const { state: agentState, audioTrack } = useVoiceAssistant();
  const { cards } = useMedia();
  const results = useSearchSources();
  const arrivals =
    cards
      .map((c) => c.id)
      .sort()
      .join('|') +
    results
      .map((r) => r.id)
      .sort()
      .join('|');
  const previousArrivals = useRef(arrivals);
  useEffect(() => {
    if (arrivals !== previousArrivals.current) setChatOpen(true);
    previousArrivals.current = arrivals;
  }, [arrivals]);
  const stateLabel = session.isConnected
    ? ({
        speaking: 'Speaking',
        thinking: 'Thinking',
        listening: 'Listening',
        idle: 'Ready',
        initializing: 'Connecting',
        connecting: 'Connecting',
        disconnected: 'Disconnected',
        'pre-connect-buffering': 'Connecting',
        failed: 'Connection failed',
      }[agentState] ?? 'Connecting')
    : 'Reconnecting';

  const controls: AgentControlBarControls = {
    leave: true,
    microphone: true,
    chat: supportsChatInput,
    camera: supportsVideoInput,
    screenShare: supportsScreenShare,
  };

  return (
    <section
      ref={ref}
      className={cn(
        'bg-background relative z-10 flex h-full w-full flex-col overflow-hidden',
        className
      )}
      {...props}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="bg-background z-10 flex min-h-16 shrink-0 items-center justify-between gap-3 border-b px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {chatOpen && (
              <div className="h-8 w-10 shrink-0" aria-hidden="true">
                <AgentAudioVisualizerBar
                  state={agentState}
                  audioTrack={audioTrack}
                  barCount={5}
                  className="h-full w-full gap-1"
                />
              </div>
            )}
            <div>
              <p className="font-medium">Diana</p>
              <p className="text-muted-foreground text-xs" role="status">
                {stateLabel}
              </p>
            </div>
          </div>
          {chatOpen && isCameraEnabled && cameraTrack && (
            <VideoTrack trackRef={cameraTrack} className="h-12 w-12 rounded-lg object-cover" />
          )}
          <button
            type="button"
            className="min-h-11 rounded-full border px-4 text-sm"
            onClick={() => {
              setChatOpen(!chatOpen);
              if (chatOpen) setTranscriptOpen(false);
            }}
          >
            {chatOpen ? 'Back to voice' : 'Conversation'}
          </button>
        </header>
        <div className="relative min-h-0 flex-1">
          <div className={cn('h-full', !chatOpen && 'hidden')} aria-hidden={!chatOpen}>
            <ConversationResults
              messages={transcriptOpen ? messages : []}
              visible={chatOpen}
              showTranscript={transcriptOpen}
            />
          </div>
          {!chatOpen && (
            <div className="absolute inset-0">
              <TileLayout
                chatOpen={false}
                audioVisualizerType={audioVisualizerType}
                audioVisualizerColor={audioVisualizerColor}
                audioVisualizerColorShift={audioVisualizerColorShift}
                audioVisualizerBarCount={audioVisualizerBarCount}
                audioVisualizerRadialBarCount={audioVisualizerRadialBarCount}
                audioVisualizerRadialRadius={audioVisualizerRadialRadius}
                audioVisualizerGridRowCount={audioVisualizerGridRowCount}
                audioVisualizerGridColumnCount={audioVisualizerGridColumnCount}
                audioVisualizerWaveLineWidth={audioVisualizerWaveLineWidth}
              />
            </div>
          )}
        </div>
      </div>
      {/* Bottom */}
      <motion.div
        {...BOTTOM_VIEW_MOTION_PROPS}
        className="bg-background z-50 shrink-0 border-t px-3 pt-2 pb-[env(safe-area-inset-bottom)] md:px-6"
      >
        {/* Pre-connect message */}
        {isPreConnectBufferEnabled && !chatOpen && (
          <AnimatePresence>
            {messages.length === 0 && (
              <MotionMessage
                key="pre-connect-message"
                duration={2}
                aria-hidden={messages.length > 0}
                {...SHIMMER_MOTION_PROPS}
                className="pointer-events-none mx-auto block w-full max-w-2xl pb-4 text-center text-sm font-semibold"
              >
                {preConnectMessage}
              </MotionMessage>
            )}
          </AnimatePresence>
        )}
        <div className="bg-background relative mx-auto max-w-2xl pb-3 md:pb-4">
          <Fade bottom className="absolute inset-x-0 top-0 h-4 -translate-y-full" />
          {supportsVideoInput && (
            <p role="status" className="mb-2 text-center text-sm">
              {isCameraEnabled
                ? 'Camera on · Ask “What do you see?” to inspect a current image.'
                : 'Camera off · Turn it on to show Diana something.'}
              <span className="text-muted-foreground block text-xs">
                Live video is shared while on. Requested snapshots are sent to LiveKit/OpenAI for
                analysis.
              </span>
            </p>
          )}
          {deviceError && (
            <p role="alert" className="mb-2 text-sm">
              Unable to access the device. Check browser permissions and try again.
            </p>
          )}
          <Attachments />
          <AgentControlBar
            saveUserChoices={false}
            onDeviceError={handleDeviceError}
            variant="livekit"
            controls={controls}
            isChatOpen={transcriptOpen}
            isConnected={session.isConnected}
            onIsChatOpenChange={toggleTranscript}
          />
        </div>
      </motion.div>
    </section>
  );
}
