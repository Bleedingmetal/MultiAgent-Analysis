/**
 * Desk: a support agent behind a counter, headset on, forearms on the counter, a
 * handset on its cradle beside a monitor. The pointer is the customer: as it comes
 * near, the agent turns to face it and leans in, the mic boom swings down to the mouth
 * and the right hand lifts the handset off the cradle; when it leaves, the call ends.
 * The read-out says `on call` or `rest`. The slider is how close a customer has to
 * come before the agent picks up, in world units.
 *
 * The pattern: a continuous answer. One spring for the turn, one for the pickup,
 * both read against the ground plane, which never moves.
 */
const {
  Cam, circ, clamp, facing, fit, hull, lerp, open, poly, prism, proj, rad, ringAt, rings, rrect, run, unproj,
  spring, stepS, disposer, mk, pointer, put, register, solid,
} = HL;

const DESK = [0, 18, 112, 62], DH = 22, MON = [74, 23, 102, 26], MH = 22, CRAD = [82, 44, 102, 55], HAND = [80, 45.5, 104, 53.5];
// the agent: hips narrower than shoulders, head above, headset ring over the crown
const AX = 36, AY = -2, HIPS = [24, -14, 48, 10], SHOULD = [18, -17, 54, 13], TH = 31, HEAD_R = 8, HZ0 = 33, HZ1 = 47, BAND_R = 9.6, EAR_Z = 40;
const REST_TURN = 12, MAX_TURN = 50, LIFT = 16, LEAN = 5;

/** A ring turned by th degrees about the agent's axis and pushed `lean` towards the counter. */
function turned(ring, th, lean) {
  const c = Math.cos(rad(th)), s = Math.sin(rad(th));
  return ring.map((q) => ({
    u: AX + (q.u - AX) * c - (q.v - AY) * s,
    v: AY + lean + (q.u - AX) * s + (q.v - AY) * c,
    nu: q.nu * c - q.nv * s,
    nv: q.nu * s + q.nv * c,
  }));
}

/** A point on the agent: (dx, dy) from the axis at height z, turned and leaned the same way. */
function at(P, th, lean, dx, dy, z) {
  const c = Math.cos(rad(th)), s = Math.sin(rad(th));
  return P(AX + dx * c - dy * s, AY + lean + dx * s + dy * c, z);
}

/** A forearm: a rounded bar from (x0, y0) at height z0 to (x1, y1) at z1, as the hull of two small rings. */
function arm(P, x0, y0, z0, x1, y1, z1) {
  const a = rrect(x0 - 3, y0 - 3, x0 + 3, y0 + 3, 3, 4), b = rrect(x1 - 3.4, y1 - 3.4, x1 + 3.4, y1 + 3.4, 3.4, 4);
  return poly(hull(ringAt(P, a, z0).concat(ringAt(P, a, z0 + 5), ringAt(P, b, z1), ringAt(P, b, z1 + 5))));
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let reach = value;

  const C = Cam(45, 0.5, 3.0);
  fit(C, [[DESK[0], AY - 20, 0], [DESK[2], DESK[3], 0], [DESK[0], DESK[3], 0], [DESK[2], AY - 20, 0], [AX, AY, HZ1 + BAND_R + 3], [HAND[2], HAND[3], DH + 8 + LIFT]], 200, 164);
  const P = proj(C), front = facing(C);
  const g = mk("g", {}, svg);

  // the agent, painted first: it sits behind the counter
  const agent = mk("g", {}, g);
  const torso = solid(agent), head = solid(agent);
  const band = mk("path", { class: "nf" }, agent), ear = mk("path", { class: "nf hi" }, agent), boom = mk("path", { class: "nf" }, agent);
  const [hips] = rings(...HIPS, 9, 1.4), [should, shouldInner] = rings(...SHOULD, 9, 1.5);
  const [headRing, headInner] = [circ(HEAD_R, 16), circ(HEAD_R - 1.3, 16)].map((r) => r.map((q) => ({ ...q, u: q.u + AX, v: q.v + AY })));

  // the counter, then what stands on it, back to front; the forearms lie on it
  const [dRing, dInner] = rings(...DESK, 6, 1.8);
  put(solid(g), prism(P, front, dRing, dInner, 0, DH));
  const [mRing, mInner] = rings(...MON, 1.2, 0.5);
  put(solid(g), prism(P, front, mRing, mInner, DH, DH + MH));
  const leftArm = mk("path", { class: "sil" }, g), rightArm = mk("path", { class: "sil" }, g);
  const [cRing, cInner] = rings(...CRAD, 2, 0.6);
  put(solid(g), prism(P, front, cRing, cInner, DH, DH + 3));
  const hand = solid(g);
  const [hRing, hInner] = rings(...HAND, 3.5, 0.9);

  const turn = spring(REST_TURN), pick = spring(0);
  let drawnTurn = NaN, drawnPick = NaN;

  function draw(th, k) {
    if (th === drawnTurn && k === drawnPick) return;
    drawnTurn = th; drawnPick = k;
    const lean = LEAN * k;
    // torso: shoulders wider than the hips, so its two rings are hulled by hand (rule 09)
    torso.sil.setAttribute("d", poly(hull(ringAt(P, turned(hips, th, lean), 0).concat(ringAt(P, turned(should, th, lean), TH)))));
    torso.cr.setAttribute("d", open(ringAt(P, run(turned(shouldInner, th, lean), front), TH)));
    put(head, prism(P, front, turned(headRing, th, lean), turned(headInner, th, lean), HZ0, HZ1));
    // the headset: a band over the crown ear to ear, the earpiece on the near ear, the mic on its boom
    const arc = [];
    for (let i = 0; i <= 14; i++) { const a = Math.PI * (i / 14); arc.push(at(P, th, lean, -BAND_R * Math.cos(a), 0, EAR_Z + BAND_R * Math.sin(a))); }
    band.setAttribute("d", open(arc));
    const earPts = [];
    for (let i = 0; i < 14; i++) { const a = (Math.PI * 2 * i) / 14; earPts.push(at(P, th, lean, -BAND_R - 0.8, 3 * Math.cos(a), EAR_Z + 3 * Math.sin(a))); }
    ear.setAttribute("d", poly(earPts));
    const drop = lerp(2, -6, k), out = lerp(-2.5, 7.5, k);
    boom.setAttribute("d", open([at(P, th, lean, -BAND_R - 0.8, 3, EAR_Z), at(P, th, lean, -BAND_R + 1, out, EAR_Z + drop)]));
    // forearms on the counter; the right hand follows the handset up
    leftArm.setAttribute("d", arm(P, 22, 14 + lean, DH, 20, 30, DH));
    rightArm.setAttribute("d", arm(P, 50, 14 + lean, DH, lerp(66, 86, k), lerp(32, 46, k), DH + k * LIFT));
    put(hand, prism(P, front, hRing, hInner, DH + 3 + k * LIFT, DH + 8 + k * LIFT));
  }
  draw(REST_TURN, 0);

  const B = register(stage, (dt) => {
    const a = stepS(turn, dt), b = stepS(pick, dt);
    draw(turn.x, pick.x);
    return a || b;
  });
  bag.add(B.unregister);

  let onCall = false;
  function answer(p) {
    if (!p) { turn.t = REST_TURN; pick.t = 0; onCall = false; }
    else {
      const [wx, wy] = unproj(C, p[0], p[1], 0);
      const near = Math.hypot(wx - AX, wy - AY) < reach;
      // face the customer: the angle from straight ahead (+y, towards the counter), clamped to a turn of the shoulders
      turn.t = near ? clamp((Math.atan2(wx - AX, wy - AY) * 180) / Math.PI, -MAX_TURN, MAX_TURN) : REST_TURN;
      pick.t = near ? 1 : 0;
      onCall = near;
    }
    // one bright mark: the earpiece at rest, the handset on a call (rule 04)
    ear.classList.toggle("hi", !onCall);
    hand.sil.classList.toggle("hi", onCall);
    read.textContent = onCall ? "on call" : "rest";
    B.wake();
  }
  bag.add(pointer(stage, { move: answer, leave: () => answer(null) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { reach = v; },
    destroy: bag.dispose,
  };
}

hairline({
  name: "desk",
  means: "A support agent behind a counter: come near and they turn to you, lean in, the mic swings down and a hand lifts the handset.",
  rules: [1, 3, 4, 5, 8],
  range: [45, 85, 140],
  tour: [[300, 130], [110, 230], [330, 240], null],
  mount,
});
