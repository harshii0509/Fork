// Fork's sounds: few and soft. Each is a small synth recipe (layers of oscillators with an envelope,
// an optional pitch glide, a shared reverb), played with the Web Audio API. Nothing is recorded or loaded.
window.Sounds = (() => {
  // Something you were waiting on finished: C5 E5 G5, rising, soft-edged, a little room. Sine with no FM
  // and a 10ms attack so it never clicks or bites; the top note glides up to A5 so it ends on a lift.
  const done = {
    layers: [
      { source: { type: 'sine', frequency: 523.25 }, envelope: { attack: 0.01, decay: 0.25, release: 0.1 }, gain: 0.19 },
      { source: { type: 'sine', frequency: 659.25 }, envelope: { attack: 0.01, decay: 0.25, release: 0.1 }, gain: 0.16, delay: 0.07 },
      { source: { type: 'sine', frequency: { start: 783.99, end: 880 } }, envelope: { attack: 0.01, decay: 0.35, release: 0.12 }, gain: 0.14, delay: 0.14 },
    ],
    effects: [{ type: 'reverb', decay: 0.5, damping: 0.5, mix: 0.1 }],
  };

  // How long a sound lasts, tail included (check.mjs keeps every sound short).
  const length = (def) => Math.max(...def.layers.map((l) => (l.delay || 0) + (l.envelope.attack || 0) + l.envelope.decay + (l.envelope.release || 0)))
    + Math.max(0, ...(def.effects || []).map((e) => (e.type === 'reverb' ? e.decay : 0)));

  // A room: decaying noise, quieter at the top end the more it's damped.
  function impulse(ac, { decay, damping = 0.5 }) {
    const n = Math.ceil(ac.sampleRate * decay), buf = ac.createBuffer(2, n, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < n; i++) {
        last = last * damping + (Math.random() * 2 - 1) * (1 - damping); // one-pole lowpass on the noise
        d[i] = last * Math.pow(1 - i / n, 3);
      }
    }
    return buf;
  }

  // Draw a recipe into any AudioContext (live, or offline to render a preview), starting at `at`.
  function render(ac, def, at = ac.currentTime) {
    const out = ac.createGain();
    out.connect(ac.destination);
    let bus = out;
    const reverb = (def.effects || []).find((e) => e.type === 'reverb');
    if (reverb) {
      const conv = ac.createConvolver(), wet = ac.createGain();
      conv.buffer = impulse(ac, reverb);
      wet.gain.value = reverb.mix;
      bus = ac.createGain();
      bus.connect(out);
      bus.connect(conv).connect(wet).connect(out);
    }
    for (const l of def.layers) {
      const t0 = at + (l.delay || 0), { attack = 0, decay, release = 0.01 } = l.envelope;
      const osc = ac.createOscillator(), amp = ac.createGain(), f = l.source.frequency;
      osc.type = l.source.type;
      if (typeof f === 'number') osc.frequency.value = f;
      else {
        osc.frequency.setValueAtTime(f.start, t0);
        osc.frequency.exponentialRampToValueAtTime(f.end, t0 + attack + decay);
      }
      amp.gain.setValueAtTime(0.0001, t0);
      amp.gain.exponentialRampToValueAtTime(l.gain, t0 + Math.max(attack, 0.002));
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay + release);
      osc.connect(amp).connect(bus);
      osc.start(t0);
      osc.stop(t0 + attack + decay + release + 0.02);
    }
  }

  let ac = null;
  function play(def) {
    try {
      ac ??= new AudioContext();
      if (ac.state === 'suspended') ac.resume();
      render(ac, def);
    } catch {} // no audio device: stay quiet
  }

  return { done, play, render, length };
})();
