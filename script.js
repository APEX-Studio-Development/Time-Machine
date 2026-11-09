(() => {
  const stageLanding = document.getElementById("stage-landing");
  const stageExperience = document.getElementById("stage-experience");
  const stageFlashback = document.getElementById("stage-flashback");
  const stageShutdown = document.getElementById("stage-shutdown");

  const startBtn = document.getElementById("start-btn");
  const canvas = document.getElementById("wave-canvas");
  const ctx = canvas.getContext("2d");

  const countdownOverlay = document.getElementById("countdown-overlay");
  const yearDisplay = document.getElementById("year-display");
  const clockRing = document.getElementById("clock-ring");

  // Stage 3.5 Search HUD Elements
  const searchHudOverlay = document.getElementById("search-hud-overlay");
  const searchHudCard = document.getElementById("search-hud-card");
  const searchGlobe = document.getElementById("search-globe");
  const searchTextCol = document.getElementById("search-text-col");
  const searchStatusTag = document.getElementById("search-status-tag");
  const searchMainHeading = document.getElementById("search-main-heading");
  const searchSubDesc = document.getElementById("search-sub-desc");
  const searchMatchBadge = document.getElementById("search-match-badge");
  const searchFooterStatus = document.getElementById("search-footer-status");

  // Stage 4 Slideshow, Connection Lost & Credits Elements
  const slideA = document.getElementById("slide-a");
  const slideB = document.getElementById("slide-b");
  const connectionLostOverlay = document.getElementById("connection-lost-overlay");
  const anomalyHudCard = document.getElementById("anomaly-hud-card");
  const creditsOverlay = document.getElementById("credits-overlay");
  const marvelPrefixText = document.getElementById("marvel-prefix-text");

  // Stage 5 Shutdown Elements
  const poweroffModal = document.getElementById("poweroff-modal");
  const shutdownInner = document.getElementById("shutdown-inner");

  if (marvelPrefixText && CONFIG.creditTitlePrefix) {
    marvelPrefixText.textContent = CONFIG.creditTitlePrefix;
  }

  // Generate 60 precision clock ticks
  if (clockRing) {
    clockRing.innerHTML = "";
    for (let i = 0; i < 60; i++) {
      const tick = document.createElement("div");
      const isMajor = i % 5 === 0;
      tick.className = isMajor ? "clock-tick-mark major-tick" : "clock-tick-mark";
      tick.style.transform = `rotate(${i * 6}deg) translateY(-193px)`;
      clockRing.appendChild(tick);
    }
  }

  // Audio Tracks
  const narrationAudio = new Audio(CONFIG.narrationSrc);
  narrationAudio.preload = "auto";

  const musicAudio = new Audio(CONFIG.musicSrc);
  musicAudio.preload = "auto";
  musicAudio.onerror = () => {
    musicAudio.src = CONFIG.musicFallbackSrc;
  };

  const creditsAudio = new Audio(CONFIG.creditsMusicSrc);
  creditsAudio.preload = "auto";
  let creditsAudioAvailable = true;
  creditsAudio.onerror = () => {
    creditsAudioAvailable = false;
  };

  let audioCtx = null;
  let analyser = null;
  let freqData = null;
  let timeData = null;
  let smoothedBars = null;
  let animFrameId = null;
  let endingSequenceStarted = false;
  let flashbackStarted = false;

  let sequenceSessionId = 0;
  let activeTimeouts = [];
  let activeIntervals = [];

  const HALF_BARS = 44;
  const TOTAL_BARS = HALF_BARS * 2 + 1;

  // Pre-decode all 20 images to guarantee zero texture lag or repeat glitches
  const preloadedImages = new Map();
  function preloadAllSlideImages() {
    for (let i = 1; i <= CONFIG.totalImages; i++) {
      const src = `${CONFIG.imagePathPrefix}${i}${CONFIG.imageExtension}`;
      if (!preloadedImages.has(i)) {
        const img = new Image();
        img.decoding = "async";
        img.src = src;
        preloadedImages.set(i, img);
      }
    }
  }
  preloadAllSlideImages();

  function addManagedTimeout(fn, delay) {
    const id = setTimeout(fn, delay);
    activeTimeouts.push(id);
    return id;
  }

  function addManagedInterval(fn, delay) {
    const id = setInterval(fn, delay);
    activeIntervals.push(id);
    return id;
  }

  function clearAllManagedTimers() {
    sequenceSessionId++;
    activeTimeouts.forEach((id) => clearTimeout(id));
    activeIntervals.forEach((id) => clearInterval(id));
    activeTimeouts = [];
    activeIntervals = [];
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  function activateOnlyStage(targetStage) {
    [stageLanding, stageExperience, stageFlashback, stageShutdown].forEach((st) => {
      st.classList.toggle("active", st === targetStage);
    });
  }

  async function initAudioEngine() {
    if (audioCtx) {
      if (audioCtx.state === "suspended") await audioCtx.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
    await audioCtx.resume();

    const source = audioCtx.createMediaElementSource(narrationAudio);
    source.connect(audioCtx.destination);

    const highpass = audioCtx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 340;

    const vocalBoost = audioCtx.createBiquadFilter();
    vocalBoost.type = "peaking";
    vocalBoost.frequency.value = 1750;
    vocalBoost.Q.value = 1.1;
    vocalBoost.gain.value = 9.5;

    const lowpass = audioCtx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 4200;

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.minDecibels = -72;
    analyser.maxDecibels = -14;
    analyser.smoothingTimeConstant = 0.42;

    source.connect(highpass);
    highpass.connect(vocalBoost);
    vocalBoost.connect(lowpass);
    lowpass.connect(analyser);

    freqData = new Uint8Array(analyser.frequencyBinCount);
    timeData = new Uint8Array(analyser.fftSize);
    smoothedBars = new Float32Array(HALF_BARS + 1);
  }

  function renderWaveform() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const centerY = h / 2;
    ctx.clearRect(0, 0, w, h);

    if (!analyser) return;

    analyser.getByteFrequencyData(freqData);
    analyser.getByteTimeDomainData(timeData);

    let sumSquares = 0;
    for (let i = 0; i < timeData.length; i++) {
      const sample = (timeData[i] - 128) / 128;
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / timeData.length);
    const vocalEnergy = Math.max(0, (rms - 0.025) * 4.2);

    if (vocalEnergy > 0.01 && !endingSequenceStarted) {
      const glowRadius = Math.min(w, h) * (0.18 + Math.min(vocalEnergy, 1) * 0.25);
      const ambientGrad = ctx.createRadialGradient(w / 2, centerY, 2, w / 2, centerY, glowRadius);
      ambientGrad.addColorStop(0, `rgba(212, 175, 55, ${Math.min(0.24, vocalEnergy * 0.22)})`);
      ambientGrad.addColorStop(0.5, `rgba(70, 150, 210, ${Math.min(0.12, vocalEnergy * 0.1)})`);
      ambientGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = ambientGrad;
      ctx.fillRect(0, 0, w, h);
    }

    const maxSpan = Math.min(w * 0.68, 820);
    const startX = (w - maxSpan) / 2;

    ctx.beginPath();
    ctx.strokeStyle = `rgba(212, 175, 55, ${endingSequenceStarted ? 0.12 : 0.22 + Math.min(0.55, vocalEnergy * 0.6)})`;
    ctx.lineWidth = 1.4;

    for (let i = 0; i < timeData.length; i++) {
      const progress = i / (timeData.length - 1);
      const x = startX + progress * maxSpan;
      const norm = progress * 2 - 1;
      const windowTaper = Math.exp(-3.5 * norm * norm);

      const pcmSample = (timeData[i] - 128) / 128;
      const gatedSample = Math.abs(pcmSample) < 0.02 ? 0 : pcmSample;
      const y = centerY + gatedSample * 190 * windowTaper;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const barSpacing = maxSpan / TOTAL_BARS;
    const NOISE_GATE = 42;

    for (let i = 0; i <= HALF_BARS; i++) {
      const binIndex = 4 + i;
      const rawByte = freqData[binIndex] || 0;
      const gatedVal = Math.max(0, rawByte - NOISE_GATE) / (255 - NOISE_GATE);

      if (gatedVal > smoothedBars[i]) {
        smoothedBars[i] = smoothedBars[i] * 0.3 + gatedVal * 0.7;
      } else {
        smoothedBars[i] = smoothedBars[i] * 0.78 + gatedVal * 0.22;
      }

      const normDist = i / HALF_BARS;
      const bellEnvelope = Math.exp(-2.6 * normDist * normDist);
      const barHeight = Math.max(2, smoothedBars[i] * 210 * bellEnvelope * (endingSequenceStarted ? 0.25 : 1) + 2);

      const drawBarAt = (barIndex) => {
        const x = startX + barIndex * barSpacing;
        const grad = ctx.createLinearGradient(0, centerY - barHeight / 2, 0, centerY + barHeight / 2);

        if (barHeight <= 3.5) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
        } else {
          grad.addColorStop(0, "rgba(212, 175, 55, 0.18)");
          grad.addColorStop(0.5, "rgba(255, 255, 255, 0.92)");
          grad.addColorStop(1, "rgba(212, 175, 55, 0.18)");
          ctx.fillStyle = grad;
        }

        ctx.beginPath();
        ctx.roundRect(x, centerY - barHeight / 2, 2.4, barHeight, 2);
        ctx.fill();
      };

      if (i === 0) {
        drawBarAt(HALF_BARS);
      } else {
        drawBarAt(HALF_BARS - i);
        drawBarAt(HALF_BARS + i);
      }
    }

    animFrameId = requestAnimationFrame(renderWaveform);
  }

  function playChronoTick(pitch = 180) {
    if (!audioCtx || audioCtx.state !== "running") return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(pitch, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(45, audioCtx.currentTime + 0.04);

      gain.gain.setValueAtTime(0.045, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.045);
    } catch (err) { }
  }

  function playTargetFoundLockSfx() {
    if (!audioCtx || audioCtx.state !== "running") return;
    try {
      const now = audioCtx.currentTime;
      [587.33, 880].forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + idx * 0.09);
        gain.gain.setValueAtTime(0.06, now + idx * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.35);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + idx * 0.09);
        osc.stop(now + idx * 0.09 + 0.36);
      });
    } catch (err) { }
  }

  function playConnectionLostSfx() {
    if (!audioCtx || audioCtx.state !== "running") return;
    try {
      const now = audioCtx.currentTime;

      // 1. Sub-bass power-down drop
      const subOsc = audioCtx.createOscillator();
      const subGain = audioCtx.createGain();
      subOsc.type = "sine";
      subOsc.frequency.setValueAtTime(135, now);
      subOsc.frequency.exponentialRampToValueAtTime(28, now + 0.85);
      subGain.gain.setValueAtTime(0.18, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
      subOsc.connect(subGain);
      subGain.connect(audioCtx.destination);
      subOsc.start(now);
      subOsc.stop(now + 0.92);

      // 2. Telemetry disconnect triple-beep
      [640, 480, 320].forEach((freq, idx) => {
        const beepOsc = audioCtx.createOscillator();
        const beepGain = audioCtx.createGain();
        beepOsc.type = "triangle";
        const startT = now + idx * 0.14;
        beepOsc.frequency.setValueAtTime(freq, startT);
        beepGain.gain.setValueAtTime(0.08, startT);
        beepGain.gain.exponentialRampToValueAtTime(0.001, startT + 0.11);
        beepOsc.connect(beepGain);
        beepGain.connect(audioCtx.destination);
        beepOsc.start(startT);
        beepOsc.stop(startT + 0.12);
      });
    } catch (err) { }
  }

  // Unified Narration Ending Sequence (03:12 to 03:20)
  function startUnifiedNarrationEndingSequence() {
    if (endingSequenceStarted) return;
    endingSequenceStarted = true;

    const fastCountdownMs = (CONFIG.countdownDurationSec || 3.5) * 1000;
    const searchingMs = (CONFIG.searchingDurationSec || 2.0) * 1000;

    canvas.classList.add("dimmed");
    countdownOverlay.classList.remove("clock-exit");
    countdownOverlay.classList.add("countdown-visible");

    let currentYear = CONFIG.presentYear;
    const targetYear = CONFIG.targetPastYear;
    const totalSteps = currentYear - targetYear;
    const stepMs = fastCountdownMs / totalSteps;

    yearDisplay.textContent = currentYear;

    const clockInterval = addManagedInterval(() => {
      if (currentYear > targetYear) {
        currentYear--;
        yearDisplay.classList.add("tick-step");
        playChronoTick(150 + (currentYear - targetYear) * 9);

        addManagedTimeout(() => {
          yearDisplay.textContent = currentYear;
          yearDisplay.classList.remove("tick-step");
        }, 45);
      } else {
        clearInterval(clockInterval);
      }
    }, stepMs);

    // At +3.5s (03:15.5): Morph from Clock into "Searching Complete."
    addManagedTimeout(() => {
      yearDisplay.textContent = targetYear;
      countdownOverlay.classList.add("clock-exit");

      addManagedTimeout(() => {
        countdownOverlay.classList.remove("countdown-visible", "clock-exit");
        runSearchAndFoundHud(searchingMs);
      }, 320);
    }, fastCountdownMs);
  }

  function runSearchAndFoundHud(searchingMs = 2000) {
    cancelAnimationFrame(animFrameId);
    canvas.style.display = "none";

    searchHudCard.classList.remove("portal-warp-exit");
    searchGlobe.classList.remove("found-amber");
    searchTextCol.classList.remove("text-morph-out");
    searchStatusTag.className = "hud-status-line";
    searchStatusTag.innerHTML = '<span class="status-indicator">((•))</span> SCANNING TIMELINE';
    searchMainHeading.textContent = "Searching Complete.";
    searchSubDesc.textContent = "Locking onto 2010–2026 memory coordinates...";
    searchMatchBadge.classList.add("hidden-badge");
    searchFooterStatus.textContent = "SCANNING";

    searchHudOverlay.classList.add("hud-visible");

    // Smooth Cross-Dissolve into "Dr. Tanoy Kumar Dey Found."
    addManagedTimeout(() => {
      searchTextCol.classList.add("text-morph-out");

      addManagedTimeout(() => {
        searchGlobe.classList.add("found-amber");
        searchStatusTag.className = "hud-status-line status-confirmed";
        searchStatusTag.textContent = "✓ SIGNAL CONFIRMED";
        searchMainHeading.textContent = "Dr. Tanoy Kumar Dey Found.";
        searchSubDesc.textContent = "Timeline match confirmed. Opening memory archive...";
        searchMatchBadge.classList.remove("hidden-badge");
        searchFooterStatus.textContent = "SIGNAL LOCKED";
        searchTextCol.classList.remove("text-morph-out");
        playTargetFoundLockSfx();
      }, 260);
    }, searchingMs);
  }

  // Golden Portal Warp Zoom into Flashback Photos
  function transitionHudToFlashback() {
    if (flashbackStarted) return;
    flashbackStarted = true;

    searchHudCard.classList.add("portal-warp-exit");
    addManagedTimeout(() => {
      searchHudOverlay.classList.remove("hud-visible");
      searchHudCard.classList.remove("portal-warp-exit");
      activateOnlyStage(stageFlashback);
      startFlashbackSequence(1);
    }, 650);
  }

  narrationAudio.addEventListener("timeupdate", () => {
    if (!narrationAudio.duration || endingSequenceStarted) return;
    const elapsed = narrationAudio.currentTime;
    const totalEndingWindow =
      (CONFIG.countdownDurationSec || 3.5) +
      (CONFIG.searchingDurationSec || 2.0) +
      (CONFIG.foundDurationSec || 2.5);

    if (
      elapsed >= CONFIG.countdownStartSec ||
      narrationAudio.duration - elapsed <= totalEndingWindow
    ) {
      startUnifiedNarrationEndingSequence();
    }
  });

  narrationAudio.addEventListener("ended", () => {
    transitionHudToFlashback();
  });

  async function setSlideSourceAndReveal(showSlide, hideSlide, imgIndex, session) {
    const src = `${CONFIG.imagePathPrefix}${imgIndex}${CONFIG.imageExtension}`;
    const cached = preloadedImages.get(imgIndex);

    showSlide.classList.remove("visible");
    showSlide.src = cached ? cached.src : src;

    try {
      if (showSlide.decode) {
        await showSlide.decode();
      }
    } catch (e) { }

    if (session !== sequenceSessionId) return;

    requestAnimationFrame(() => {
      if (session !== sequenceSessionId) return;
      showSlide.classList.add("visible");
      hideSlide.classList.remove("visible");
    });
  }

  // Stage 4: Glitch-Free 20-Image Chronological Slideshow (02:50 total)
  function startFlashbackSequence(startIndex = 1) {
    clearAllManagedTimers();
    const currentSession = sequenceSessionId;

    connectionLostOverlay.classList.remove("hud-visible");
    creditsOverlay.classList.remove("credits-visible");
    creditsAudio.pause();

    slideA.classList.remove("visible");
    slideB.classList.remove("visible");

    if (musicAudio.paused) {
      musicAudio.currentTime = ((startIndex - 1) * CONFIG.imageDurationMs) / 1000;
      musicAudio.volume = 0;
      musicAudio.play().catch(() => { });

      let vol = 0;
      addManagedInterval(() => {
        vol = Math.min(CONFIG.musicVolume, vol + 0.02);
        musicAudio.volume = vol;
      }, 100);
    }

    let currentImgIndex = startIndex;
    let useSlideA = true;

    setSlideSourceAndReveal(slideA, slideB, currentImgIndex, currentSession);

    addManagedInterval(() => {
      if (currentSession !== sequenceSessionId) return;
      currentImgIndex++;

      if (currentImgIndex > CONFIG.totalImages) {
        triggerConnectionLostAndCredits();
        return;
      }

      useSlideA = !useSlideA;

      if (useSlideA) {
        setSlideSourceAndReveal(slideA, slideB, currentImgIndex, currentSession);
      } else {
        setSlideSourceAndReveal(slideB, slideA, currentImgIndex, currentSession);
      }
    }, CONFIG.imageDurationMs);
  }

  // Stage 4.5: Connection Lost + SFX -> Signal Power-Down Dissolve -> Marvel Credits
  function triggerConnectionLostAndCredits() {
    clearAllManagedTimers();

    slideA.classList.remove("visible");
    slideB.classList.remove("visible");

    addManagedInterval(() => {
      if (musicAudio.volume > 0.02) {
        musicAudio.volume = Math.max(0, musicAudio.volume - 0.03);
      } else {
        musicAudio.volume = 0;
        musicAudio.pause();
      }
    }, 80);

    playConnectionLostSfx();

    anomalyHudCard.classList.remove("signal-dissolve-exit");
    connectionLostOverlay.classList.add("hud-visible");

    addManagedTimeout(() => {
      anomalyHudCard.classList.add("signal-dissolve-exit");

      addManagedTimeout(() => {
        connectionLostOverlay.classList.remove("hud-visible");
        anomalyHudCard.classList.remove("signal-dissolve-exit");
        startMarvelCreditsSequence();
      }, 850);
    }, 3200);
  }

  // Stage 4.8: Clean Marvel-Style Credits with credits.mp3 + Subhodeep Rajak
  function startMarvelCreditsSequence() {
    clearAllManagedTimers();

    musicAudio.pause();

    const activeCreditTrack = creditsAudioAvailable ? creditsAudio : musicAudio;
    const targetVol = CONFIG.creditsMusicVolume || 0.45;
    activeCreditTrack.currentTime = 0;
    activeCreditTrack.volume = 0;
    activeCreditTrack.play().catch(() => { });

    let vol = 0;
    const fadeInId = addManagedInterval(() => {
      vol = Math.min(targetVol, vol + 0.03);
      activeCreditTrack.volume = vol;
      if (vol >= targetVol) clearInterval(fadeInId);
    }, 100);

    creditsOverlay.classList.add("credits-visible");

    const cards = [
      document.getElementById("credit-card-1"),
      document.getElementById("credit-card-2"),
      document.getElementById("credit-card-3"),
      document.getElementById("credit-card-4"),
      document.getElementById("credit-card-5"),
      document.getElementById("credit-card-6")
    ];

    const cardDuration = CONFIG.creditCardDurationMs || 3200;
    const totalCreditsDuration = cards.length * cardDuration;

    let currentCardIdx = 0;
    cards.forEach((c, idx) => c.classList.toggle("active-card", idx === 0));

    addManagedInterval(() => {
      if (currentCardIdx < cards.length - 1) {
        cards[currentCardIdx].classList.remove("active-card");
        currentCardIdx++;
        cards[currentCardIdx].classList.add("active-card");
      }
    }, cardDuration);

    addManagedTimeout(() => {
      addManagedInterval(() => {
        if (activeCreditTrack.volume > 0.02) {
          activeCreditTrack.volume = Math.max(0, activeCreditTrack.volume - 0.025);
        } else {
          activeCreditTrack.volume = 0;
          activeCreditTrack.pause();
        }
      }, 120);
    }, totalCreditsDuration - 3000);

    addManagedTimeout(() => {
      runFinalShutdownSequence();
    }, totalCreditsDuration);
  }

  // Stage 5: Shutdown Spinner for 10 Seconds -> Complete Dead-Black Power Off
  function runFinalShutdownSequence() {
    clearAllManagedTimers();

    narrationAudio.pause();
    musicAudio.pause();
    creditsAudio.pause();
    cancelAnimationFrame(animFrameId);

    creditsOverlay.classList.remove("credits-visible");
    activateOnlyStage(stageShutdown);

    shutdownInner.classList.remove("power-off-complete");
    poweroffModal.classList.add("active-shutdown");

    addManagedTimeout(() => {
      shutdownInner.classList.add("power-off-complete");
      document.body.style.cursor = "none";
      if (audioCtx && audioCtx.state === "running") {
        audioCtx.suspend().catch(() => { });
      }
    }, CONFIG.shutdownDurationMs);
  }

  // Start Button Click
  startBtn.addEventListener("click", async () => {
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => { });
    }

    clearAllManagedTimers();
    endingSequenceStarted = false;
    flashbackStarted = false;
    canvas.style.display = "block";
    canvas.classList.remove("dimmed");
    document.body.style.cursor = "default";

    await initAudioEngine();
    activateOnlyStage(stageExperience);
    renderWaveform();

    narrationAudio.currentTime = 0;
    narrationAudio.play().catch((err) => {
      console.error("Audio playback error:", err);
    });
  });
})();