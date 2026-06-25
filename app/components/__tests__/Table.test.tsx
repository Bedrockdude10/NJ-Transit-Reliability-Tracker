import { render } from "@testing-library/react-native";
import { Table } from "../Table";

describe("Table", () => {
  it("renders headers and row cells", () => {
    const { getByText } = render(
      <Table
        columns={[
          { key: "a", label: "Col A" },
          { key: "b", label: "Col B" },
        ]}
        rows={[{ a: "hello", b: 42 }]}
      />,
    );
    expect(getByText("Col A")).toBeTruthy();
    expect(getByText("hello")).toBeTruthy();
    expect(getByText("42")).toBeTruthy();
  });

  it("shows an empty message with no rows", () => {
    const { getByText } = render(<Table columns={[{ key: "a", label: "A" }]} rows={[]} />);
    expect(getByText("No data for this period.")).toBeTruthy();
  });
});
