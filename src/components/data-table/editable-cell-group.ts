// EditableCell 命名空间对象（自 EditableCell.tsx 拆出——组件文件只留组件；
// 消费方以 EditableCell.Text / EditableCell.Select 分发，本文件保持该入口形态不变）。
import { EditableCellText, EditableCellSelect } from "./EditableCell";

export const EditableCell = { Text: EditableCellText, Select: EditableCellSelect };
