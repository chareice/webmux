# Top-Down Office Redesign

## Overview

Redesign the pixel-art office dashboard from a flat side-view grid layout to a top-down management sim inspired by Stardew Valley. The app becomes a "pixel office park" where you manage AI agent sessions as robot workers in office buildings.

## Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Game genre | Management sim | Best fit for monitoring AI agents |
| Completed sessions | Stay at desk, idle poses | More lively than disappearing |
| Delete session | Robot leaves office | Natural "firing" metaphor |
| View perspective | Top-down (bird's eye) | Stardew Valley style |
| Workstation size | Medium (~32x32px) | Balance between density and detail |
| Office layout | Corridor with wall-facing desks | Recognizable office look |
| Position on status change | Fixed — pose changes, not position | Prevents confusion |

## Scene Architecture

### Park View (Default)

Top-down grass field with office building rooftops scattered on it.

- Each building = one project (grouped by `repoPath`)
- Rooftop: rectangular with tile texture (brown/red pixel stripes)
- Rooftop size scales with active session count
- Chimney in corner: smokes when running sessions exist, quiet when all idle
- Status badge on rooftop: `⚡3 💤15` (3 working, 15 idle)
- Name plate above rooftop
- Decorative elements on grass: trees, flowers, stone paths

Interactions:
- Scroll/pan to browse all buildings
- Tap rooftop → enter building (roof "lifts off")
- Long-press rooftop → project quick menu
- Tap "+ New Office" → new session form
- Bottom action bar: total robot count + New Session button

### Indoor View (After tapping a building)

Top-down office floor plan with corridor in the middle.

```
┌──────────────────────────────────────────┐
│  ← Back to Park          webmux  1F/3F  │
├──────────────────────────────────────────┤
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐    🌿      │
│ │desk│ │desk│ │desk│ │desk│            │
│ └────┘ └────┘ └────┘ └────┘             │
│                                          │
│ ░░░░░░░░░ corridor ░░░░░░░░ ☕ ░░░░░░░░ │
│                                          │
│ ┌────┐ ┌────┐ ┌────┐         🚪        │
│ │desk│ │desk│ │desk│                    │
│ └────┘ └────┘ └────┘                     │
├──────────────────────────────────────────┤
│        ◀ 1F    ●●○  3F ▶               │
└──────────────────────────────────────────┘
```

Layout rules:
- Two rows of desks facing opposite walls, corridor in between
- Max 4-6 desks per row (responsive to screen width)
- Max 8-12 desks per floor
- Door in corner (decorative, entry point)
- Corridor decorations: coffee machine, plants, water cooler (1-2 random per floor)
- Floor pagination at bottom with swipe or arrow tap

Position assignment:
- New session gets assigned to an empty desk on creation, position is fixed forever
- Status changes only affect the robot's pose, never its position
- Deleting a session = robot leaves, desk becomes empty
- Floors ordered by creation time: newest on 1F, older on higher floors

Interactions:
- Tap desk → enter session detail (thread view)
- Long-press desk → context menu (interrupt / delete)
- Tap empty desk → new session form (project pre-filled)
- Swipe left/right → change floor
- Tap back → return to park view (roof closes)

## Robot States (Top-Down View)

Each workstation is ~32x32px, showing: desk (light wood rectangle), monitor (thin bar on desk), keyboard (dot pattern), robot head (circle with antenna), chair (dark square).

### Active States

**running:**
- Robot facing desk, hands on keyboard
- Monitor lit (blue/green screen)
- Antenna: bright green, blinking animation
- Only state with animation (typing + antenna blink)

**queued / waiting:**
- Robot facing desk, one hand raised
- Monitor dim with "..." dots
- Antenna: yellow
- "?" speech bubble (static)

**error / failed:**
- Robot head down on desk
- Monitor: red screen
- Antenna: red, tilted
- "!" bubble + small smoke puffs (static)

### Idle States (completed — randomly assigned on completion, then fixed)

**Sleeping (ZZZ):**
- Head down on desk
- Monitor off
- Antenna: dim green
- "ZZZ" bubble floating

**Phone (scrolling):**
- Chair turned away from desk
- Small rectangle in hands (phone)
- Monitor off
- No effects

**Coffee:**
- Sitting at desk but leaned back
- Small cup on desk
- Monitor off
- Occasional cup raise (can be static)

### Performance

- Only `running` state has AnimationController
- All other states are static single-frame renders
- `shouldRepaint` checks status + frame, no unnecessary redraws

## Technical Approach

### Rendering

Both park and indoor views rendered with a single `CustomPainter` each. No Flutter widget grid — pure Canvas drawing for flexible layout and good performance.

```
OfficeScene (StatefulWidget)
├── state: parkView | indoorView(projectId, floor)
├── parkView → ParkPainter (grass + all rooftops)
└── indoorView → IndoorPainter (one office floor)
```

Hit testing: `GestureDetector` with coordinate-based calculation to determine which building/desk was tapped.

### Sprite System

Replace current side-view `_SpritePainter` with `_TopDownSpritePainter`:
- Robot: circle (head from above) + antenna stalk + antenna ball
- Desk: rectangle with monitor bar and keyboard dots
- Chair: smaller dark rectangle below robot
- Each status has its own draw method (same pattern as current code)

### Data Flow

No changes to API or state management:
- Riverpod providers fetch thread list from API
- 10-second auto-refresh for status updates

New local state (in-memory, resets on app restart):
- `Map<String, int>` — session ID → desk position index
- `Map<String, IdlePose>` — session ID → assigned idle pose (sleeping/phone/coffee)
- Position assigned on first render, idle pose assigned when status becomes "completed"

### View Transitions

Park → Indoor: fade or "roof lift" animation (300ms)
Indoor → Park: reverse
Floor change: horizontal slide (200ms)

## Delete Animation

Simple approach: robot fades out at desk + small "exit" particle at door position. No pathfinding needed.

## Sort Priority (for floor assignment)

Sessions sorted before assigning to floors:
1. running / starting
2. error / failed
3. queued / waiting
4. recently completed (newest first)
5. older completed

1F always gets the top of this sorted list.
