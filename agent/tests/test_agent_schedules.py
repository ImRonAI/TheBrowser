"""Scheduled specialist runs: cadence validation, next due times, the run's trigger message and its report."""

from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from agent.api.core.agent_schedules import Cadence, cadence_label, next_run, run_prompt, run_summary


def utc(*parts: int) -> datetime:
    return datetime(*parts, tzinfo=UTC)


def test_cadence_rejects_unknown_zones_bad_times_and_extra_fields():
    with pytest.raises(ValidationError, match="Unknown time zone"):
        Cadence(every="day", timezone="Mars/Olympus")
    with pytest.raises(ValidationError):
        Cadence(every="day", time="25:00")
    with pytest.raises(ValidationError):
        Cadence(every="hours", hours=0)
    with pytest.raises(ValidationError):
        Cadence(every="day", cron="* * * * *")


def test_daily_runs_at_the_local_time_and_follow_daylight_saving():
    cadence = Cadence(every="day", time="08:00", timezone="America/New_York")
    # 2026-11-13 is EST (UTC-5): 08:00 local = 13:00 UTC.
    assert next_run(cadence, utc(2026, 11, 13, 12, 0)) == utc(2026, 11, 13, 13, 0)
    # Exactly at the due time, the next occurrence is tomorrow.
    assert next_run(cadence, utc(2026, 11, 13, 13, 0)) == utc(2026, 11, 14, 13, 0)
    # Across the November change (2026-11-01): Oct 31 is EDT (UTC-4), Nov 1 is EST (UTC-5).
    assert next_run(cadence, utc(2026, 10, 31, 12, 30)) == utc(2026, 11, 1, 13, 0)


def test_weekdays_skip_the_weekend_and_weekly_lands_on_its_day():
    weekdays = Cadence(every="weekdays", time="09:30", timezone="UTC")
    # Friday 2026-11-13 after 09:30 -> Monday 2026-11-16.
    assert next_run(weekdays, utc(2026, 11, 13, 10, 0)) == utc(2026, 11, 16, 9, 30)
    weekly = Cadence(every="week", weekday=2, time="07:00", timezone="Europe/Berlin")
    # Wednesday 2026-11-18, 07:00 CET = 06:00 UTC.
    assert next_run(weekly, utc(2026, 11, 13, 10, 0)) == utc(2026, 11, 18, 6, 0)
    assert next_run(weekly, utc(2026, 11, 18, 6, 0)) == utc(2026, 11, 25, 6, 0)


def test_hourly_counts_from_the_previous_due_time_and_skips_missed_runs():
    cadence = Cadence(every="hours", hours=3)
    now = utc(2026, 11, 13, 12, 0)
    assert next_run(cadence, now) == now + timedelta(hours=3)
    # Due at 11:58, checked at 12:00: the next is 14:58, not 15:00 (no drift by the check interval).
    assert next_run(cadence, now, utc(2026, 11, 13, 11, 58)) == utc(2026, 11, 13, 14, 58)
    # The API was down for a day: the missed occurrences are skipped, not replayed.
    assert next_run(cadence, now, utc(2026, 11, 12, 9, 0)) == utc(2026, 11, 13, 15, 0)


def test_labels_and_the_trigger_message():
    assert cadence_label(Cadence(every="hours", hours=1)) == "every hour"
    assert cadence_label(Cadence(every="week", weekday=4, time="18:00")) == "Fridays at 18:00"
    cadence = Cadence(every="day", time="08:00")
    prompt = run_prompt(name="Espresso Gear Scout", description="Tracks grinder deals.", task="", cadence=cadence)
    # The first line titles the thread (threads.thread_title).
    assert prompt.splitlines()[0] == "Espresso Gear Scout · scheduled run (daily at 08:00)"
    assert "Do your recurring work: Tracks grinder deals." in prompt
    assert "by its schedule (daily at 08:00)" in prompt
    manual = run_prompt(name="Scout", description="", task="Check the Niche Zero price.", cadence=None)
    assert manual.startswith("Scout · run now\n\nCheck the Niche Zero price.")


def test_run_summary_is_the_last_assistant_text():
    messages = [
        {"role": "user", "content": [{"text": "go"}]},
        {"role": "assistant", "content": [{"text": "Looking."}, {"toolUse": {"name": "brave_web_search"}}]},
        {"role": "user", "content": [{"toolResult": {"content": []}}]},
        {"role": "assistant", "content": [{"reasoningContent": {}}, {"text": "  Found **3** deals.  "}]},
    ]
    assert run_summary(messages) == "Found **3** deals."
    assert run_summary([{"role": "user", "content": [{"text": "go"}]}]) == ""
    long = run_summary([{"role": "assistant", "content": [{"text": "x" * 2000}]}])
    assert len(long) == 600 and long.endswith("…")
