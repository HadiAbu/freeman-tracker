from typing import Protocol

import openai
from pydantic import ValidationError

from app.analysis.schema import LlmAnalysis


class LlmError(Exception):
    """Base class. Messages are safe to show: no keys, prompts or positions."""


class LlmUnavailable(LlmError):
    """The provider could not be used (network, quota, auth, config)."""


class LlmBadOutput(LlmError):
    """The model answered, but not with a usable structured result."""


class LlmClient(Protocol):
    model: str

    def analyze(self, instructions: str, input_text: str) -> LlmAnalysis: ...


_MESSAGES = {
    "auth": "OpenAI rejected the API key.",
    "rate": "OpenAI rate limit or quota reached.",
    "timeout": "OpenAI did not respond in time.",
    "failed": "The OpenAI request failed.",
}


class OpenAiLlm:
    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        timeout: float = 45.0,
        client=None,
        max_attempts: int = 2,
    ):
        if not api_key or not model:
            raise LlmUnavailable("OpenAI is not configured (key or model missing).")
        self.model = model
        self._timeout = timeout
        self._max_attempts = max_attempts
        self._client = client or openai.OpenAI(api_key=api_key, timeout=timeout, max_retries=0)

    def analyze(self, instructions: str, input_text: str) -> LlmAnalysis:
        for _attempt in range(self._max_attempts):
            failure = None  # kind of provider failure; raised after leaving the except block
            response = None
            try:
                response = self._client.responses.parse(
                    model=self.model,
                    instructions=instructions,
                    input=input_text,
                    text_format=LlmAnalysis,
                    max_output_tokens=1500,
                    store=False,  # do not keep the prompt (it can contain the user's position) at OpenAI
                    timeout=self._timeout,
                )
            except openai.AuthenticationError:
                failure = "auth"
            except openai.RateLimitError:
                failure = "rate"
            except (openai.APITimeoutError, openai.APIConnectionError):
                failure = "timeout"
            except ValidationError:
                continue  # malformed structured output: try again
            except openai.OpenAIError:
                failure = "failed"

            if failure:
                # Raised outside the except block so __context__ is None (no chained provider error).
                raise LlmUnavailable(_MESSAGES[failure])

            parsed = getattr(response, "output_parsed", None)
            if isinstance(parsed, LlmAnalysis):
                return parsed
        raise LlmBadOutput("The model did not return a usable analysis.")
