"""The announcer: who goes next. A fixed table, written as code, not an AI.

Letting a model decide the order would let a model skip the gate or send the run round in
circles, and a replay would not be the same twice. So the controller asks this table, which
returns one announcement: what is said, who is up, which stage the run is in, and who passed
the ball. The text goes into the log, and the next agent hears it in its prompt.

    order        -> builder
    candidate    -> the gate (not an agent)
    gate_red     -> builder (repair n of m), or the run stops when the repairs are used up
    gate_green   -> reviewer
    gap          -> builder (repair n of m), or the run stops when the repairs are used up
    no_change    -> builder (repair n of m): the builder left the folder as it was
    approved     -> the GM
"""

from dataclasses import dataclass

STAGES = ("order", "build", "gate", "review", "repair1", "repair2", "decision")


@dataclass(frozen=True)
class Call:
    text: str
    to: str | None  # builder | gate | reviewer | gm, or None when the run stops
    stage: str
    pass_from: str | None = None

    @property
    def stops(self) -> bool:
        return self.to is None


def _repair_stage(attempt: int) -> str:
    return f"repair{min(attempt, 2)}"


def announce(
    step: str,
    *,
    order_id: str = "",
    title: str = "",
    candidate: str = "",
    repairs_used: int = 0,
    max_repairs: int = 2,
) -> Call:
    """The announcement for `step`. `repairs_used` counts repairs already made."""
    nxt = repairs_used + 1
    if step == "order":
        return Call(
            f"Work order {order_id} is on the floor: {title}. Builder, you are up.",
            "builder",
            "order",
            "order",
        )
    if step == "candidate":
        return Call(f"Candidate {candidate} is posted. Stat crew, run the gate.", "gate", "gate", "builder")
    if step in ("gate_red", "gap", "no_change"):
        source = {"gate_red": "gate", "gap": "reviewer", "no_change": "builder"}[step]
        what = {
            "gate_red": f"Gate failed on {candidate}.",
            "gap": "The coach found a gap.",
            "no_change": "The builder changed nothing.",
        }[step]
        if repairs_used >= max_repairs:
            return Call(f"{what} The repairs are used up, so the run stops here.", None, "decision", source)
        return Call(
            f"{what} Builder, repair attempt {nxt} of {max_repairs}.",
            "builder",
            _repair_stage(nxt),
            source,
        )
    if step == "gate_green":
        return Call("Gate passed. Coach, review it.", "reviewer", "review", "gate")
    if step == "approved":
        return Call("Ready for the GM. The call is yours.", "gm", "decision", "reviewer")
    if step == "stopped":
        return Call("Stop order received. The run is stopped.", None, "decision")
    if step == "out_of_time":
        return Call("The shot clock ran out. The run is stopped.", None, "decision")
    raise ValueError(f"unknown step: {step}")
