from types import SimpleNamespace

import httpx
import openai
import pytest

from app.analysis.llm import LlmBadOutput, LlmUnavailable, OpenAiLlm
from app.analysis.schema import LlmAnalysis

GOOD = LlmAnalysis(stance="hold", confidence="low", summary="s", case_for=[], case_against=[], watch_for=[])
REQ = httpx.Request("POST", "https://api.openai.com/v1/responses")


class FakeResponses:
    def __init__(self, outcomes):
        self.outcomes, self.calls = list(outcomes), []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return SimpleNamespace(output_parsed=outcome)


def make(outcomes, **kw):
    fake = SimpleNamespace(responses=FakeResponses(outcomes))
    return OpenAiLlm("sk-test-SECRET", "test-model", client=fake, **kw), fake.responses


def test_success_passes_the_expected_arguments_and_never_stores_the_prompt():
    llm, responses = make([GOOD])
    assert llm.analyze("rules", "input json") is GOOD
    call = responses.calls[0]
    assert call["model"] == "test-model" and call["instructions"] == "rules" and call["input"] == "input json"
    assert call["text_format"] is LlmAnalysis and call["store"] is False
    assert call["timeout"] == 45.0 and call["max_output_tokens"] > 0


def test_a_model_attribute_is_exposed_for_recording():
    assert make([GOOD])[0].model == "test-model"


def test_unparsed_output_is_retried_once_then_succeeds():
    llm, responses = make([None, GOOD])
    assert llm.analyze("r", "i") is GOOD
    assert len(responses.calls) == 2


def test_unparsed_output_twice_is_a_bad_output_error():
    llm, responses = make([None, None])
    with pytest.raises(LlmBadOutput):
        llm.analyze("r", "i")
    assert len(responses.calls) == 2


@pytest.mark.parametrize("error, fragment", [
    (openai.APITimeoutError(request=REQ), "in time"),
    (openai.APIConnectionError(request=REQ), "in time"),
    (openai.RateLimitError("limit", response=httpx.Response(429, request=REQ), body=None), "rate limit"),
    (openai.AuthenticationError("nope", response=httpx.Response(401, request=REQ), body=None), "api key"),
    (openai.InternalServerError("oops", response=httpx.Response(500, request=REQ), body=None), "failed"),
])
def test_provider_errors_become_safe_unavailable_errors_without_retrying(error, fragment):
    llm, responses = make([error, GOOD])
    with pytest.raises(LlmUnavailable) as exc:
        llm.analyze("secret prompt", "secret position data")
    msg = str(exc.value).lower()
    assert fragment in msg
    assert "sk-test" not in msg and "secret" not in msg
    assert len(responses.calls) == 1


@pytest.mark.parametrize("error", [
    openai.APITimeoutError(request=REQ),
    openai.AuthenticationError("sk-test-SECRET", response=httpx.Response(401, request=REQ), body=None),
])
def test_safe_errors_carry_no_chained_provider_exception(error):
    llm, _ = make([error])
    with pytest.raises(LlmUnavailable) as exc:
        llm.analyze("r", "i")
    assert exc.value.__context__ is None and exc.value.__cause__ is None


def test_missing_credentials_is_reported_before_any_call():
    with pytest.raises(LlmUnavailable):
        OpenAiLlm("", "m")
    with pytest.raises(LlmUnavailable):
        OpenAiLlm("k", "")
