import { useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import FilterBar from '../components/common/FilterBar';
import EmptyPanel from '../components/common/EmptyPanel';
import { useHoleFilter } from '../hooks/useHoleFilter';
import { useHoleStore, holeProgressList } from '../stores/holeStore';
import { useRunStore } from '../stores/runStore';
import { useBoxStore } from '../stores/boxStore';
import { RIG_NOS, SHIFTS, type DrillHole, type SurveyPoint } from '../types/drill-hole';
import { mergeRanges } from '../utils/recovery';
import { uid } from '../utils/id';

const { Title, Paragraph, Text } = Typography;

/** 设计资料（地质设计组维护）：设计孔深与设计见矿层位 */
interface HoleFormValues {
  holeNo: string;
  coordX: number;
  coordY: number;
  collarElevation: number;
  designDepth: number;
  designOreFrom: number;
  designOreTo: number;
  startDate: Dayjs;
  rigNo: string;
  shift: string;
  surveyText?: string;
  remark?: string;
}

/** 终孔报告（钻探班组维护）：终孔深度与终孔日期 */
interface FinalReportFormValues {
  finalDepth: number;
  endDate?: Dayjs;
}

/** 解析测斜文本：每行「深度,倾角,方位角」 */
function parseSurvey(text: string | undefined): SurveyPoint[] {
  if (!text) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [depth, dip, azimuth] = line.split(/[,，\s]+/).map((v) => Number(v));
      return { id: uid('sv'), depth: depth || 0, dip: dip || 0, azimuth: azimuth || 0 };
    });
}

function surveyToText(points: SurveyPoint[]): string {
  return points.map((p) => `${p.depth},${p.dip},${p.azimuth}`).join('\n');
}

/** 钻孔台帐：地质设计组维护设计孔深与见矿层位，钻探班组另登记终孔报告 */
export default function HoleList() {
  const { message } = AntApp.useApp();
  const holes = useHoleStore((s) => s.holes);
  const addHole = useHoleStore((s) => s.addHole);
  const updateHole = useHoleStore((s) => s.updateHole);
  const updateFinalReport = useHoleStore((s) => s.updateFinalReport);
  const removeHole = useHoleStore((s) => s.removeHole);
  const runs = useRunStore((s) => s.runs);
  const removeRunsByHole = useRunStore((s) => s.removeByHole);
  const boxes = useBoxStore((s) => s.boxes);

  const filter = useHoleFilter();
  const [form] = Form.useForm<HoleFormValues>();
  const [reportForm] = Form.useForm<FinalReportFormValues>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DrillHole | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportHole, setReportHole] = useState<DrillHole | null>(null);

  const visible = useMemo(() => filter.apply(holes), [holes, filter]);
  const progressByHole = useMemo(() => {
    const map = new Map<string, boolean>();
    holeProgressList(holes, runs).forEach((item) => map.set(item.hole.id, item.needSupplement));
    return map;
  }, [holes, runs]);

  const coverageText = (holeId: string) => {
    const merged = mergeRanges(runs.filter((run) => run.holeId === holeId).map((run) => ({ from: run.fromDepth, to: run.toDepth })));
    if (merged.length === 0) return '尚无回次';
    return merged.map((range) => `${range.from}~${range.to}m`).join('、');
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      coordX: 512340,
      coordY: 3210880,
      collarElevation: 1240,
      designDepth: 200,
      designOreFrom: 120,
      designOreTo: 180,
      startDate: dayjs(),
      rigNo: 'XY-1',
      shift: '甲班',
      surveyText: '50,88.5,132',
    } as unknown as HoleFormValues);
    setOpen(true);
  };

  const openEdit = (record: DrillHole) => {
    setEditing(record);
    form.setFieldsValue({
      holeNo: record.holeNo,
      coordX: record.coordX,
      coordY: record.coordY,
      collarElevation: record.collarElevation,
      designDepth: record.designDepth,
      designOreFrom: record.designOreFrom,
      designOreTo: record.designOreTo,
      startDate: dayjs(record.startDate),
      rigNo: record.rigNo,
      shift: record.shift,
      surveyText: surveyToText(record.surveyData),
      remark: record.remark,
    } as unknown as HoleFormValues);
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const payload = {
      holeNo: values.holeNo,
      coordX: Number(values.coordX) || 0,
      coordY: Number(values.coordY) || 0,
      collarElevation: Number(values.collarElevation) || 0,
      designDepth: Number(values.designDepth) || 0,
      designOreFrom: Number(values.designOreFrom) || 0,
      designOreTo: Number(values.designOreTo) || 0,
      startDate: values.startDate.toISOString(),
      rigNo: values.rigNo,
      shift: values.shift,
      surveyData: parseSurvey(values.surveyText),
      remark: values.remark,
    };
    if (editing) {
      await updateHole(editing.id, payload);
      message.success(`已更新设计资料 ${payload.holeNo}`);
    } else {
      await addHole(payload);
      message.success(`已建孔 ${payload.holeNo}`);
    }
    setOpen(false);
  };

  const openFinalReport = (record: DrillHole) => {
    setReportHole(record);
    reportForm.setFieldsValue({
      finalDepth: record.finalDepth || 0,
      endDate: record.endDate ? dayjs(record.endDate) : undefined,
    });
    setReportOpen(true);
  };

  const submitFinalReport = async () => {
    if (!reportHole) return;
    const values = await reportForm.validateFields();
    await updateFinalReport(reportHole.id, {
      finalDepth: Number(values.finalDepth) || 0,
      endDate: values.endDate ? values.endDate.toISOString() : undefined,
    });
    message.success(`已登记终孔报告 ${reportHole.holeNo}`);
    setReportOpen(false);
  };

  const columns: TableColumnsType<DrillHole> = [
    { title: '孔号', dataIndex: 'holeNo', width: 110, render: (v: string) => <Text strong>{v}</Text> },
    { title: '钻机', dataIndex: 'rigNo', width: 90 },
    { title: '班组', dataIndex: 'shift', width: 80 },
    { title: '坐标(X, Y)', width: 200, render: (_, row) => `${row.coordX}, ${row.coordY}` },
    { title: '孔口标高(m)', dataIndex: 'collarElevation', width: 110, align: 'right' },
    { title: '设计孔深(m)', dataIndex: 'designDepth', width: 110, align: 'right' },
    {
      title: '设计见矿层位(m)',
      width: 140,
      align: 'right',
      render: (_, row) =>
        row.designOreTo > row.designOreFrom ? `${row.designOreFrom}~${row.designOreTo}` : '-',
    },
    { title: '终孔深度(m)', dataIndex: 'finalDepth', width: 110, align: 'right', render: (v: number) => (v > 0 ? v : '-') },
    {
      title: '深度覆盖（回次）',
      width: 260,
      render: (_, row) => <span style={{ fontSize: 12 }}>{coverageText(row.id)}</span>,
    },
    { title: '岩芯箱', width: 90, align: 'right', render: (_, row) => `${boxes.filter((b) => b.holeId === row.id).length} 箱` },
    { title: '测斜点', width: 90, align: 'right', render: (_, row) => `${row.surveyData.length} 点` },
    {
      title: '状态',
      width: 150,
      render: (_, row) => {
        if (progressByHole.get(row.id)) return <Tag color="red">见矿层位未覆盖 · 待补勘</Tag>;
        if (row.endDate) return <Tag color="green">已终孔</Tag>;
        return <Tag color="blue">在钻</Tag>;
      },
    },
    {
      title: '操作',
      width: 210,
      fixed: 'right',
      render: (_, record) => (
        <Space size={2}>
          <Button size="small" type="link" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button size="small" type="link" onClick={() => openFinalReport(record)}>
            终孔报告
          </Button>
          <Popconfirm
            title={`确认删除 ${record.holeNo}？（同时清除其回次）`}
            onConfirm={async () => {
              await removeRunsByHole(record.id);
              await removeHole(record.id);
              message.success('已删除钻孔及其回次');
            }}
          >
            <Button size="small" type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        钻孔台帐
      </Title>
      <Paragraph type="secondary">
        地质设计组维护设计孔深与设计见矿层位；钻探班组通过「终孔报告」登记终孔深度与终孔日期，回次进尺在「回次记录」录入。两份资料各管各的，互不串改。
      </Paragraph>

      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" onClick={openCreate}>
          新建钻孔
        </Button>
      </Space>

      <FilterBar
        fields={[
          { key: 'rig', label: '钻机', options: RIG_NOS, width: 110 },
          { key: 'shift', label: '施工班组', options: SHIFTS, width: 110 },
        ]}
        keywordPlaceholder="搜索孔号 / 钻机 / 备注"
        resultCount={visible.length}
        totalCount={holes.length}
      />

      {visible.length === 0 ? (
        <EmptyPanel description="没有符合条件的钻孔" actionText="重置筛选条件" onAction={filter.reset}>
          <div style={{ marginTop: 8 }}>
            <Button type="link" onClick={openCreate}>
              或直接新建一个钻孔
            </Button>
          </div>
        </EmptyPanel>
      ) : (
        <Card size="small">
          <Table rowKey="id" size="small" columns={columns} dataSource={visible} pagination={{ pageSize: 8 }} scroll={{ x: 1620 }} />
        </Card>
      )}

      <Modal
        open={open}
        title={editing ? `编辑设计资料 · ${editing.holeNo}` : '新建钻孔'}
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText="保存"
        cancelText="取消"
        width={720}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="本页为地质设计组资料：设计孔深与设计见矿层位。终孔深度与终孔日期请用行内「终孔报告」登记。"
        />
        <Form form={form} layout="vertical">
          <Form.Item name="holeNo" label="孔号" rules={[{ required: true, message: '请输入孔号' }]}>
            <Input placeholder="如：ZK-2406" maxLength={20} />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="coordX" label="坐标 X" rules={[{ required: true, message: '请输入坐标 X' }]}>
              <InputNumber style={{ width: 180 }} placeholder="坐标 X" />
            </Form.Item>
            <Form.Item name="coordY" label="坐标 Y" rules={[{ required: true, message: '请输入坐标 Y' }]}>
              <InputNumber style={{ width: 180 }} placeholder="坐标 Y" />
            </Form.Item>
            <Form.Item name="collarElevation" label="孔口标高(m)" rules={[{ required: true, message: '请输入孔口标高' }]}>
              <InputNumber style={{ width: 160 }} placeholder="孔口标高" />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="designDepth" label="设计孔深(m)" rules={[{ required: true, message: '请输入设计孔深' }]}>
              <InputNumber min={0} style={{ width: 160 }} placeholder="设计孔深" />
            </Form.Item>
            <Form.Item
              name="designOreFrom"
              label="设计见矿层位 · 起(m)"
              rules={[{ required: true, message: '请输入见矿层位起深度' }]}
            >
              <InputNumber min={0} style={{ width: 160 }} placeholder="见矿层位起" />
            </Form.Item>
            <Form.Item
              name="designOreTo"
              label="设计见矿层位 · 止(m)"
              rules={[{ required: true, message: '请输入见矿层位止深度' }]}
            >
              <InputNumber min={0} style={{ width: 160 }} placeholder="见矿层位止" />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="startDate" label="开孔日期" rules={[{ required: true, message: '请选择开孔日期' }]}>
              <DatePicker style={{ width: 180 }} />
            </Form.Item>
            <Form.Item name="rigNo" label="钻机号" rules={[{ required: true, message: '请选择钻机号' }]}>
              <Select style={{ width: 150 }} options={RIG_NOS.map((v) => ({ label: v, value: v }))} />
            </Form.Item>
            <Form.Item name="shift" label="施工班组" rules={[{ required: true, message: '请选择班组' }]}>
              <Select style={{ width: 140 }} options={SHIFTS.map((v) => ({ label: v, value: v }))} />
            </Form.Item>
          </Space>
          <Form.Item name="surveyText" label="测斜数据（每行：深度,倾角,方位角）">
            <Input.TextArea rows={3} placeholder={'50,88.5,132\n100,87.2,133.5'} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={80} placeholder="其他设计说明" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={reportOpen}
        title={reportHole ? `终孔报告 · ${reportHole.holeNo}` : '终孔报告'}
        onCancel={() => setReportOpen(false)}
        onOk={submitFinalReport}
        okText="保存报告"
        cancelText="取消"
        width={480}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="钻探班组登记：终孔深度与终孔日期。设计孔深与设计见矿层位由地质设计组维护，本页不可修改。"
        />
        <Form form={reportForm} layout="vertical">
          <Form.Item
            name="finalDepth"
            label="终孔深度(m)"
            rules={[{ required: true, message: '请输入终孔深度（未终孔填 0）' }]}
          >
            <InputNumber min={0} style={{ width: 200 }} placeholder="未终孔填 0" />
          </Form.Item>
          <Form.Item name="endDate" label="终孔日期（未终孔留空）">
            <DatePicker style={{ width: 200 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
