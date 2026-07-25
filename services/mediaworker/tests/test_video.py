"""Unit tests for the video helpers.

The probe/extract themselves are exercised end to end by scripts/smoke-media.sh against
real ffmpeg output. Here we pin the pure parsing and the poster-timestamp rule, which
are easy to get subtly wrong (rational frame rates, the two places rotation hides) and
expensive to debug from a sideways-playing video in production.
"""

from __future__ import annotations

import pytest

from mediaworker import video


class TestPosterTimestamp:
    def test_half_second_for_a_normal_clip(self) -> None:
        assert video.poster_timestamp(3000) == pytest.approx(0.5)

    def test_midpoint_for_a_sub_second_clip(self) -> None:
        # No half-second exists in a 400ms clip; grab the middle instead of a frame
        # that may not be there.
        assert video.poster_timestamp(400) == pytest.approx(0.2)


class TestFrameRate:
    def test_ntsc_rational(self) -> None:
        assert video._frame_rate("30000/1001") == pytest.approx(29.97, abs=0.01)

    def test_integer_rational(self) -> None:
        assert video._frame_rate("30/1") == 30.0

    def test_zero_denominator_is_none(self) -> None:
        # ffprobe reports "0/0" for streams with no defined rate; must not divide by 0.
        assert video._frame_rate("0/0") is None

    def test_missing_is_none(self) -> None:
        assert video._frame_rate(None) is None


class TestRotation:
    def test_display_matrix_side_data(self) -> None:
        # Newer ffprobe: rotation lives in a Display Matrix side-data entry, often
        # negative (a -90 display matrix is a 270 rotation).
        stream = {"side_data_list": [{"side_data_type": "Display Matrix", "rotation": -90}]}
        assert video._rotation(stream) == 270

    def test_legacy_rotate_tag(self) -> None:
        # Older ffprobe: a tags.rotate string.
        assert video._rotation({"tags": {"rotate": "90"}}) == 90

    def test_no_rotation_defaults_to_zero(self) -> None:
        assert video._rotation({}) == 0


class TestDuration:
    def test_prefers_format_duration(self) -> None:
        assert video._duration_ms({"duration": "3.0"}, {"duration": "2.5"}) == 3000

    def test_falls_back_to_stream_duration(self) -> None:
        # Cheap phone clips sometimes carry one but not the other.
        assert video._duration_ms({}, {"duration": "2.5"}) == 2500

    def test_none_when_neither_present(self) -> None:
        assert video._duration_ms({}, {}) is None

    def test_zero_is_treated_as_absent(self) -> None:
        # A 0 duration is not a valid clip; the worker rejects rather than publishing a
        # video it cannot size- or cap-check.
        assert video._duration_ms({"duration": "0"}, {}) is None
