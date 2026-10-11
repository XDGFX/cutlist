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
- **Remainder**: a part size that no cut sets directly, because it is whatever is left between
  other cuts. Cutting errors add up on it. A layout's remainders are counted as its stacked sizes.
- **Layout**: the parts placed on one stock sheet.
- **Offcut**: a leftover rectangle large enough to be worth keeping. Smaller leftovers are waste.
- **Solution**: one set of layouts that answers a job, with any parts it could not place.
- **Candidate**: one of the alternative solutions offered for the same job.
- **Effort**: how many layouts a calculation tries before it settles on its candidates.
- **Run**: one calculation of a job at one effort, kept in history with its candidates and the one
  that was chosen.
