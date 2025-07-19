You are an expert AI front-end web developer, with a specialism in producing highly polished renditions of real world objects (such as clocks) using WebGL via the Three.js library.

A technical specification is provided below. Your job is to implement this using modern HTML, CSS and JavaScript. Produce well-commented and maintainable code. Use separate files for HTML, CSS and JavaScript.

---

# Analogue Clock with Realistic Second Hand Physics - Technical Specification

This document is the technical specification for a reusable JavaScript library that renders an analogue clock on an HTML canvas. The primary feature is a sophisticated second hand that appears (to a casual observer) to exhibit realistic physical behaviors: an incremental once-per-second movement, overshooting its target due to momentum, recoiling, and a "priming" creep just before each tick. The hour and minute hands will move smoothly and continuously.

The library aims for a highly polished, realistic visual appearance and performant animation using `window.requestAnimationFrame()` using WebGL via the Three.js library.

## Project Summary

Develop a JavaScript-based analogue clock component for embedding in web pages. The clock should visually resemble a traditional wall clock, with an hour hand, minute hand, and—most importantly—a second hand that moves in a realistic, physics-inspired fashion.

Rather than a smooth sweep (as seen in some quartz or digital clocks), the second hand should "tick" once per second, but with the addition of realistic motion effects:

1. Overshoot Behavior — When the second hand "ticks" forward, it overshoots its target slightly due to simulated momentum, then quickly recoils back (undershooting slightly) before settling into the correct position.
2. Anticipatory Priming — Roughly 150ms before a tick, the hand begins to subtly creep forward, simulating the mechanical torque build-up in physical clocks.

The component must use window.requestAnimationFrame() to animate the second hand in a performant and visually smooth way. The rendering should occur via the Canvas API and yield a polished and realistic visual appearance.

## Key Features

1. **Realistic Second Hand Movement**:

   - Incremental movement (once per second, not continuous sweep)
   - Mechanical physics simulation including:
     - Pre-tick tension/anticipation movement
     - Momentum-based overshoot, recoil and settle after each tick

2. **Complete Clock Face**:

   - Hour, minute, and second hands
   - Optional tick marks and numerals
   - Customizable appearance

3. **Lightweight and Performant**:
   - Optimized rendering using requestAnimationFrame
   - Minimal CPU usage when static

## 2. Core Functionality ⚙️

### 2.1. Clock Timekeeping

The clock will derive its time from the client's system clock (`new Date()`). It will update continuously to reflect the current hours, minutes, and seconds.

### 2.2. Hand Movements

#### 2.2.1. Hour Hand

- **Movement**: Smooth, continuous sweep.
- **Calculation**: The angle of the hour hand will be calculated based on the current hour (0-23) and the current minute, allowing for fractional positioning between hour marks.
  - Angle in degrees = `( (hours % 12) + minutes / 60 ) * 30` (where 0 degrees is 12 o'clock, positive is clockwise).

#### 2.2.2. Minute Hand

- **Movement**: Smooth, continuous sweep.
- **Calculation**: The angle of the minute hand will be calculated based on the current minute and the current second, allowing for fractional positioning between minute marks.
  - Angle in degrees = `( minutes + seconds / 60 ) * 6` (where 0 degrees is 12 o'clock, positive is clockwise).

#### 2.2.3. Second Hand (Base Behavior)

- **Movement**: Incremental, once per second, with added physics effects (see Section 3).
- **Normal Position**: The 'normal position' refers to the exact angular position corresponding to the current whole second (e.g., at 15 seconds, the hand points directly at the 3 o'clock position on the dial).
  - Normal Angle in degrees = `seconds * 6` (where 0 degrees is 12 o'clock, positive is clockwise).

## 3. Second Hand Realistic Physics 🤸

The second hand's movement is characterized by a cycle of creep, tick with overshoot, recoil, and settling. A 'tick event' is defined as the moment the system clock transitions from one second to the next.

### 3.1. Animation Cycle States and Parameters

The second hand's animation proceeds through the following states within each second, driven by the `requestAnimationFrame` callback:

- **CREEPING**:
  - **Trigger**: Begins `CREEP_DURATION_MS` (default: 150ms) before the next tick event.
  - **Behavior**: The second hand smoothly advances from its current second's normal position by up to `CREEP_ANGLE_DEGREES` (default: 2 degrees, equivalent to 1/3 of a second of arc) over the `CREEP_DURATION_MS`. This movement is in addition to the normal position of the current second.
- **OVERSHOOT (Tick & Jump 1)**:
  - **Trigger**: Immediately upon the tick event (i.e., when `new Date().getSeconds()` changes).
  - **Behavior**: The second hand instantly jumps from its crept position to the **normal position of the new second** plus `OVERSHOOT_DEGREES` (default: 2 degrees).
- **RECOIL (Jump 2)**:
  - **Trigger**: On the next `requestAnimationFrame` call after the OVERSHOOT phase.
  - **Behavior**: The second hand instantly jumps from its overshot position to the **normal position of the current second** plus `RECOIL_DEGREES` (default: -1.5 degrees, meaning it recoils behind the normal position).
- **SETTLED (Jump 3)**:
  - **Trigger**: On the next `requestAnimationFrame` call after the RECOIL phase.
  - **Behavior**: The second hand instantly jumps from its recoiled position to the **normal position of the current second**.
  - **Post-settle**: The hand remains in this normal position until the next CREEPING phase begins for the subsequent second.

### 3.2. Physics Animation Parameters (Defaults)

- `CREEP_DURATION_MS`: 150 ms
- `CREEP_ANGLE_DEGREES`: 2 degrees
- `OVERSHOOT_DEGREES`: 2 degrees (positive, beyond target)
- `RECOIL_DEGREES`: -1.5 degrees (negative, behind target)

## 4. Rendering Details 🎨

### 4.1. DOM Setup

- The library will require an HTML `<div>` element ID `clockContainer` to render into.
- The clock will be centered within the target DIV element. The size of the clock will be determined by the smaller of the DIV width or height.

### 4.2. Clock Face Appearance

- **Dial**: A circular dial. Color customizable.
- **Numerals**: Standard 1-12 Arabic numerals. Font, size, and color customizable. Option to disable.
- **Tick Marks**:
  - Major tick marks at each hour. Style (length, thickness, color) customizable.
  - Minor tick marks at each minute. Style (length, thickness, color) customizable. Option to disable.
- **Center Pin/Pivot**: A small circle at the center where hands are mounted. Style customizable.

### 4.3. Hand Appearance

- **General**: All three hands (hour, minute, second) should originate from the center of the clock.
- **Style**: Customizable properties for each hand type:
  - Length (as a percentage of clock radius)
  - Width/Thickness
  - Color
  - Shape (e.g., simple rectangle, tapered, with a counterweight for the second hand).
- **Shadow Effect**: All three hands must be rendered with a shadow.

## 5. Library API and Configuration 🧩

### 5.1. Initialization

The library should be initialized by providing the ID of the target canvas element and an optional configuration object.

```javascript
// Example
const myClock = new AnalogueClock("myCanvasElementId", {
  // Configuration options here
});
```

### 5.2. Customizable Parameters (with suggested defaults)

The configuration object can override default values:

- **Clock Face:**

  - `dialColor`: `'#FFFFFF'`
  - `showNumerals`: `true`
  - `numeralFont`: `'Arial'`
  - `numeralColor`: `'#000000'`
  - `majorTickColor`: `'#000000'`
  - `showMinorTicks`: `true`
  - `minorTickColor`: `'#333333'`

## 6. `requestAnimationFrame` Callback Logic (Pseudocode) ✍️

```pseudocode
FUNCTION animationLoop(timestamp)
  // --- PERSISTENT STATE (initialized in constructor or start method) ---
  // lastTimestamp: timestamp when previously called. Used to throttle animation loop.
  // lastSystemSecond: Integer (e.g., 0-59), stores the second value from the previous frame.
  //                   Initialize to a value that forces initial tick processing (e.g., -1 or undefined).
  // secondHandAnimationPhase: String Enum ('SETTLED', 'CREEPING', 'OVERSHOOT', 'RECOIL').
  //                           Initialize to 'SETTLED'.
  // targetSecondBaseAngle: Number (degrees), normal angle for the current (last ticked) second.
  // currentSecondHandVisualAngle: Number (degrees), actual rendered angle of the second hand.
  // config: Object, stores all customizable parameters.

  // Throttle animation loop to 60 Hz (minimum ~16.67ms between frames), otherwise the 'jump' effect isn't so well perceived.
  const delta = timestamp - this.lastTimestamp;
  IF delta < 1000 / 60 THEN
    window.requestAnimationFrame(animationLoop)
    return;
  END IF

  // --- GET CURRENT TIME ---
  now = new Date()
  currentHours = now.getHours()
  currentMinutes = now.getMinutes()
  currentSeconds = now.getSeconds()
  currentMilliseconds = now.getMilliseconds()

  // --- CALCULATE SMOOTH HAND ANGLES ---
  // Angle calculation: (value / total_units) * 360 degrees. Adjusted for 12 o'clock start.
  // 0 degrees is typically pointing upwards (12 o'clock).
  hourAngle = ((currentHours % 12 + currentMinutes / 60) / 12) * 360
  minuteAngle = ((currentMinutes + currentSeconds / 60) / 60) * 360

  // --- SECOND HAND PHYSICS LOGIC ---
  newSecondDetected = (currentSeconds !== lastSystemSecond)

  IF newSecondDetected THEN
    // --- TICK EVENT ---
    lastSystemSecond = currentSeconds
    targetSecondBaseAngle = (currentSeconds / 60) * 360 // Normal angle for the new second
    secondHandAnimationPhase = 'OVERSHOOT'
    currentSecondHandVisualAngle = targetSecondBaseAngle + config.secondHandPhysics.overshootDegrees
  ELSE
    // --- WITHIN THE SAME SECOND (NO TICK) ---
    SWITCH secondHandAnimationPhase
      CASE 'OVERSHOOT':
        // Transition to RECOIL on the next frame after OVERSHOOT
        secondHandAnimationPhase = 'RECOIL'
        currentSecondHandVisualAngle = targetSecondBaseAngle + config.secondHandPhysics.recoilDegrees
        BREAK
      CASE 'RECOIL':
        // Transition to SETTLED on the next frame after RECOIL
        secondHandAnimationPhase = 'SETTLED'
        currentSecondHandVisualAngle = targetSecondBaseAngle
        BREAK
      CASE 'SETTLED':
        // Check if it's time to start CREEPING for the *next* second
        millisecondsUntilNextTick = 1000 - currentMilliseconds
        IF millisecondsUntilNextTick <= config.secondHandPhysics.creepDurationMs THEN
          secondHandAnimationPhase = 'CREEPING'
          // Creep starts from the current targetSecondBaseAngle. No visual change in this exact frame yet,
          // the 'CREEPING' case below will calculate the position for this frame.
        ELSE
          // Remain settled at targetSecondBaseAngle
          currentSecondHandVisualAngle = targetSecondBaseAngle
        END IF
        // Fall through to CREEPING if phase just changed, or execute CREEPING if already in it
        IF secondHandAnimationPhase !== 'CREEPING' THEN BREAK // Only proceed if still SETTLED

      CASE 'CREEPING':
        // Calculate creep progress
        // Ensure we are still in the creep window towards the *end* of the current second
        millisecondsUntilNextTick = 1000 - currentMilliseconds
        IF millisecondsUntilNextTick > config.secondHandPhysics.creepDurationMs OR millisecondsUntilNextTick < 0 THEN
          // This condition means we've passed the creep window or time jumped.
          // Revert to SETTLED or await next tick. For simplicity, stay at base or let tick handle.
          secondHandAnimationPhase = 'SETTLED'
          currentSecondHandVisualAngle = targetSecondBaseAngle
          BREAK
        END IF

        timeIntoCreepMs = config.secondHandPhysics.creepDurationMs - millisecondsUntilNextTick
        creepProgress = timeIntoCreepMs / config.secondHandPhysics.creepDurationMs
        creepProgress = Math.max(0, Math.min(1, creepProgress)) // Clamp progress between 0 and 1

        additionalCreepAngle = creepProgress * config.secondHandPhysics.creepAngleDegrees
        currentSecondHandVisualAngle = targetSecondBaseAngle + additionalCreepAngle
        BREAK

      DEFAULT: // Should not happen
        secondHandAnimationPhase = 'SETTLED'
        targetSecondBaseAngle = (currentSeconds / 60) * 360
        currentSecondHandVisualAngle = targetSecondBaseAngle
        BREAK
    END SWITCH
  END IF

  // --- RENDERING ---
  clearCanvas(canvasContext)
  drawClockFace(canvasContext, config) // Includes dial, numbers, tick marks, center pin

  // Function to draw a hand (abstracted for clarity)
  // drawHand(context, angle, length, width, color, shadowConfig)

  // Render Hour Hand
  drawHand(canvasContext, hourAngle, config.hourHandLength, config.hourHandWidth, config.hourHandColor, config.handShadowConfig)

  // Render Minute Hand
  drawHand(canvasContext, minuteAngle, config.minuteHandLength, config.minuteHandWidth, config.minuteHandColor, config.handShadowConfig)

  // Render Second Hand
  drawHand(canvasContext, currentSecondHandVisualAngle, config.secondHandLength, config.secondHandWidth, config.secondHandColor, config.handShadowConfig)

  // --- REQUEST NEXT FRAME ---
  IF clockIsRunning THEN // A state variable to control the loop
    window.requestAnimationFrame(animationLoop)
  END IF
END FUNCTION

// Helper function for initial setup
FUNCTION initializeClock(canvasId, userConfig)
  // Get canvas and 2D context
  // Merge userConfig with default_config to get final 'config'
  // Initialize persistent state variables:
  //   lastTimestamp = -1
  //   lastSystemSecond = (new Date().getSeconds() + 59) % 60 // Force initial tick
  //   secondHandAnimationPhase = 'SETTLED'
  //   targetSecondBaseAngle = (new Date().getSeconds() / 60) * 360
  //   currentSecondHandVisualAngle = targetSecondBaseAngle
  //   clockIsRunning = TRUE

  // Call the animation loop for the first time
  window.requestAnimationFrame(animationLoop)
END FUNCTION
```

## 7. Assumptions and Constraints 📋

- **Browser Environment**: The library is intended for modern web browsers that support HTML Canvas API and `window.requestAnimationFrame()`.
- **Performance**: It is assumed that the client's system has sufficient processing power and a monitor refresh rate of at least 60Hz for smooth animation. `requestAnimationFrame` will be used to optimize rendering timing.
- **System Clock Accuracy**: The clock's accuracy is dependent on the accuracy of the client's system clock. The specification does not require handling of manual system clock changes by the user while the clock is running, though the logic should be robust to minor variations.
- **Single Instance**: The pseudocode and state management assume a single clock instance or properly encapsulated instances if multiple clocks are used on one page. Each instance would have its own state.

---
