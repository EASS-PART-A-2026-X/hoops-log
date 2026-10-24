# Testing strategy: split each input into partitions and test at least one value
# from each, especially both sides of every limit. A test counts only if it fails
# when the rule it protects is broken (break the rule on purpose to check).
#
# Shot fields
#   player:    missing | "" | whitespace only | 1 char | 50 chars | 51 chars | Hebrew
#   x:         -0.1 | 0 | 50 | 50.1 | missing | not a number
#   y:         -0.1 | 0 | 47 | 47.1
#   made:      true | false | missing | not a bool ("maybe")
#   game_date: omitted (defaults to today) | today | in the past | tomorrow | not a date
#   note:      omitted (defaults to "") | 200 chars | 201 chars | Hebrew
#   fields:    only known ones | an unknown one ("chef") | computed ones sent by the
#              client ("zone", "shot_type")
#
# Routes
#   shot id:   exists | missing (GET, PATCH, DELETE) | not an int (422)
#   list:      empty | several | offset/limit pages | limit 0 and 101 | offset -1
#   PATCH:     field absent | field null (leave unchanged) | new value | invalid value
#              on a missing id (422 comes before 404) | moving x, y changes the zone
#   DELETE:    first call 204 with empty body | second call 404
#   isolation: every test starts with an empty store
#
# Computed values (court geometry)
#   one spot inside each of the 10 zones classifies back to that zone
#   3PT line: on the corner line is 2PT | just beyond it is 3PT
#             on the arc is 2PT | just beyond it is 3PT
#             corner line meets the arc near y=14: both sides stay 3PT
#   left and right zones mirror each other
#   shot_type is 3PT exactly when the zone ends in "_3"
#   the response carries the computed zone and shot_type, and they follow x, y
