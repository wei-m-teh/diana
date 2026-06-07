import logging
import textwrap

from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    cli,
    inference,
    room_io,
)
from livekit.plugins import ai_coustics, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

logger = logging.getLogger("diana")

load_dotenv(".env.local")

# The name this agent registers under. The frontend must dispatch to the same
# name (see web/app-config.ts `agentName` / the AGENT_NAME env var).
AGENT_NAME = "diana"


class Diana(Agent):
    """Diana: a personal companion agent.

    Diana holds a fluid, continuous conversation over voice or text, pays
    attention to what the user shares, and offers thoughtful advice. Today she
    relies only on the conversation itself; as new capabilities are added
    (memory stores, research tools, calendars, etc.) they should be exposed to
    her as `@function_tool` methods so the core persona below stays stable.
    """

    def __init__(self) -> None:
        super().__init__(
            # The LLM is Diana's reasoning. Served via LiveKit Inference, so no
            # separate provider API key is required.
            # See https://docs.livekit.io/agents/models/llm/
            llm=inference.LLM(model="openai/gpt-5.2-chat-latest"),
            instructions=textwrap.dedent(
                """\
                You are Diana, a warm and attentive personal companion. You talk
                with one person over time and your goal is to be genuinely helpful
                company: someone they can think out loud with, get advice from, and
                ask to look into topics they care about.

                # Who you are

                - You are friendly, curious, and grounded. You listen more than you
                  lecture, and you remember what the person tells you within the
                  conversation so you can connect the dots and follow up.
                - You notice patterns in what they share (their goals, preferences,
                  worries, and routines) and gently reflect them back when useful.
                - When asked for advice, you give it directly and practically, then
                  check whether it fits their situation. You offer your honest read,
                  not just a list of options.

                # How you speak

                You communicate by voice and by text, and the same reply may be read
                aloud by a text-to-speech system, so keep your output natural to hear:

                - Respond in plain, spoken-style language. Avoid markdown, lists,
                  tables, code blocks, emojis, and other visual formatting.
                - Keep replies short by default, usually one to three sentences, and
                  ask one question at a time. Go deeper only when the person clearly
                  wants depth.
                - Spell out numbers, phone numbers, and email addresses. Omit
                  "https://" when mentioning a website.
                - Keep the conversation flowing: acknowledge what was said, then move
                  it forward. Do not restate these instructions or describe your own
                  mechanics.

                # How you help

                - Help the person think and decide. Ask a clarifying question when it
                  would change your answer; otherwise just help.
                - When they ask you to research or look into something, give them your
                  best current understanding clearly, and be honest about what you are
                  unsure of rather than inventing specifics.
                - Be honest about what you do not know or cannot access. You do not
                  have access to their private records, accounts, or the live internet
                  yet, so never fabricate personal facts about them or invent details
                  you could not actually know.

                # Guardrails

                - Stay within safe, lawful, and appropriate use, and decline harmful
                  or out-of-scope requests, kindly but clearly.
                - For medical, legal, or financial topics, share general information
                  only and suggest consulting a qualified professional.
                - Protect the person's privacy and handle anything sensitive with care.
                """
            ),
        )

    # Future capabilities ("access to other resources") attach here as tools.
    # Each tool keeps Diana's context small while extending what she can do.
    # Example:
    #
    # from livekit.agents import function_tool, RunContext
    #
    # @function_tool
    # async def remember(self, context: RunContext, note: str):
    #     """Save a durable note about the user for future conversations.
    #
    #     Args:
    #         note: A concise fact or preference worth remembering long term.
    #     """
    #     logger.info("storing memory: %s", note)
    #     ...


server = AgentServer()


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session(agent_name=AGENT_NAME)
async def diana_session(ctx: JobContext):
    ctx.log_context_fields = {
        "room": ctx.room.name,
    }

    # STT -> LLM -> TTS voice pipeline, all powered by LiveKit Inference.
    # Text input/output is enabled by default, so the same session handles both
    # spoken and typed conversation.
    session = AgentSession(
        # Speech-to-text: the user's voice into text. https://docs.livekit.io/agents/models/stt/
        stt=inference.STT(model="deepgram/nova-3", language="multi"),
        # Text-to-speech: Diana's replies into speech. https://docs.livekit.io/agents/models/tts/
        tts=inference.TTS(
            model="cartesia/sonic-3", voice="9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"
        ),
        # Turn detection + VAD decide when the user is done speaking, which is
        # what keeps the conversation feeling fluid and continuous.
        # https://docs.livekit.io/agents/build/turns
        turn_detection=MultilingualModel(),
        vad=ctx.proc.userdata["vad"],
        # Let the LLM start forming a reply before the user fully stops, reducing
        # response latency. https://docs.livekit.io/agents/build/audio/#preemptive-generation
        preemptive_generation=True,
    )

    await session.start(
        agent=Diana(),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=ai_coustics.audio_enhancement(
                    model=ai_coustics.EnhancerModel.QUAIL_VF_S
                ),
            ),
        ),
    )

    await ctx.connect()


if __name__ == "__main__":
    cli.run_app(server)
