export function getBoard(board) {
  const grid = board.map((item, index) =>
    item === null ? index + 1 : item
  );

  const gridRows = [];
  while (grid.length) {
    gridRows.push(grid.splice(0, 3));
  }

  const gridString = gridRows.map((row) => row.join(" | ")).join("\n");
  return gridString;
}
