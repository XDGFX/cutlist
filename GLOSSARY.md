# Glossary

- **Job**: the stock sheets, parts and kerf entered for one piece of work.
- **Part**: a rectangle that must be cut, with a length, a width and a quantity.
- **Stock sheet**: a board parts are cut from. Its quantity is how many are on hand, so a leftover
  from an earlier job is entered as a stock sheet of its own.
- **Length / width**: length runs along the grain; width runs across it.
- **Rotate**: turn a part 90° so its length lies across the sheet's width. A part that cannot rotate
  keeps its grain aligned with the sheet.
- **Kerf**: the width of material the blade removes with each cut.
- **Guillotine cut**: a straight cut that runs from one edge of a piece to the opposite edge.
- **Rip / crosscut**: a rip runs along the sheet's length; a crosscut runs across it.
- **Cutting order**: the cuts for one layout in the sequence to make them, each with its fence
  distance.
- **Fence move**: setting the fence to a new distance, or measuring from the opposite edge of the
  piece. Consecutive cuts on a sheet that share both need no move, whichever way they run.
- **Widest first**: sizing wider parts before narrower ones, so that a part cut wrong can still be
  cut down into a narrower one.
- **Remainder**: a part size that no cut sets directly, because it is whatever is left between
  other cuts. Cutting errors add up on it. A layout's remainders are counted as its stacked sizes.
- **Layout**: the parts placed on one stock sheet.
- **Label**: a part's name and size written on it in a layout, at the size of the sheet's heading.
  Where names are hidden it is the size alone, and a part is small only if it cannot hold that.
- **Run**: the same small part repeated side by side or end to end in a layout. It takes one label
  for the lot, such as "5 × Block", or "5 off" where names are hidden.
- **Leader**: a line from a part too small to hold its label out to the label in the margin below
  or above the sheet. Identical parts share one label.
- **Detail**: an enlarged view of a crowded region of a layout, drawn below the sheet at a scale
  where each part in it holds its label. Its region is the whole piece the crowd is cut from once
  the cuts before it are made, where that is small enough to enlarge.
- **Arm**: the dashed line from a detail's region on the sheet to the detail.
- **Offcut**: a leftover rectangle large enough to be worth keeping. Smaller leftovers are waste.
- **Solution**: one set of layouts that answers a job, with any parts it could not place.
- **Candidate**: one of the alternative solutions offered for the same job.
- **Effort**: how many layouts a calculation tries before it settles on its candidates.
- **Run**: one calculation of a job at one effort, kept in history with its candidates and the one
  that was chosen.
- **Work mode**: the page while cutting: only the chosen candidate's layouts, with no inputs, and
  each part can be tapped to mark it cut.
