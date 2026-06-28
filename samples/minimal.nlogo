globals [ last-count ]

to setup
  clear-all
  create-turtles density [
    setxy random-xcor random-ycor
  ]
  set last-count count turtles
  set-current-plot "Population"
  clear-plot
  plot last-count
  reset-ticks
end

to go
  ask turtles [
    right random 20
    left random 20
    forward 1
  ]
  set last-count count turtles
  set-current-plot "Population"
  plot last-count
  tick
end
@#$#@#$#@
GRAPHICS-WINDOW
210
10
650
450
-1
-1
13.0
1
10
1
1
1
0
1
1
1
-16
16
-16
16
1
1
1
ticks
30.0

BUTTON
10
10
100
44
setup
setup
NIL
1
T
OBSERVER
NIL
NIL
NIL
NIL
1

BUTTON
110
10
200
44
go
go
T
1
T
OBSERVER
NIL
NIL
NIL
NIL
0

SLIDER
15
56
199
115
density
density
0
100
25
1
1
turtles
HORIZONTAL

MONITOR
1
172
194
270
turtles
count turtles
0
1
11

PLOT
10
164
200
294
Population
ticks
turtles
0.0
10.0
0.0
100.0
true
true
"" ""
PENS
"turtles" 1.0 0 -16777216 true "" "plot count turtles"
@#$#@#$#@
# Minimal NetLogo Tools Smoke Test

Open this file with `NetLogo: Open Model Editor`.

- Use the slider to change `density`.
- Run `setup`.
- Run `Go once`, use `Forever`, or click the `go` button to toggle the forever loop.
- The monitor, plot, and view preview should refresh when NetLogo headless is configured.
@#$#@#$#@
default
true
0
Polygon -7500403 true true 150 5 40 250 150 205 260 250
@#$#@#$#@
NetLogo 6.4.0
@#$#@#$#@
setup
repeat 10 [ go ]
@#$#@#$#@
@#$#@#$#@
@#$#@#$#@
@#$#@#$#@
default
0.0
-0.2 0 0.0 1.0
0.0 1 1.0 0.0
0.2 0 0.0 1.0
link direction
true
0
Line -7500403 true 150 150 90 180
Line -7500403 true 150 150 210 180
@#$#@#$#@
1
@#$#@#$#@
