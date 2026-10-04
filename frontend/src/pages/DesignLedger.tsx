import { useState } from 'react';
import { Alert, App as AntApp, AutoComplete, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import EmptyPanel from '../components/common/EmptyPanel';
import { useDesignStore } from '../stores/designStore';
import { useHoleStore } from '../stores/holeStore';
import type { HoleDesign } from '../types/design';

const { Title, Paragraph, Text } = Typography;

interface DesignFormValues {
  holeNo: string;
  designDepth: number;
  oreFrom: number;
  oreTo: number;
  remark?: string;
}

/** 设计台账：地质设计组维护设计孔深与设计见矿层位，与钻探班组的台帐、回次各管各的 */
export default function DesignLedger() {
  const { message } = AntApp.useApp();
  const designs = useDesignStore((s) => s.designs);
  const addDesign = useDesignStore((s) => s.addDesign);
  const updateDesign = useDesignStore((s) => s.updateDesign);
  const removeDesign = useDesignStore((s) => s.removeDesign);
  const backfillFromHoles = useDesignStore((s) => s.backfillFromHoles);
  const holes = useHoleStore((s) => s.holes);

  const [form] = Form.useForm<DesignFormValues>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HoleDesign | null>(null);

  const designedHoleNos = new Set(designs.map((d) => d.holeNo));
  const ledgerHoleNos = new Set(holes.map((h) => h.holeNo));
  const missingCount = holes.filter((h) => !designedHoleNos.has(h.holeNo)).length;

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ designDepth: 200, oreFrom: 0, oreTo: 200 } as DesignFormValues);
    setOpen(true);
  };

  const openEdit = (record: HoleDesign) => {
    setEditing(record);
    form.setFieldsValue({
      holeNo: record.holeNo,
      designDepth: record.designDepth,
      oreFrom: record.oreFrom,
      oreTo: record.oreTo,
      remark: record.remark,
    } as DesignFormValues);
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const payload = {
      holeNo: values.holeNo.trim(),
      designDepth: Number(values.designDepth) || 0,
      oreFrom: Number(values.oreFrom) || 0,
      oreTo: Number(values.oreTo) || 0,
      remark: values.remark,
    };
    if (editing) {
      await updateDesign(editing.id, payload);
      message.success(`已更新 ${payload.holeNo} 的设计资料`);
    } else {
      if (designedHoleNos.has(payload.holeNo)) {
        message.error(`${payload.holeNo} 已有设计资料，请直接编辑`);
        return;
      }
      await addDesign(payload);
      message.success(`已登记 ${payload.holeNo} 的设计资料`);
    }
    setOpen(false);
  };

  const handleBackfill = async () => {
    const count = await backfillFromHoles(holes);
    if (count > 0) {
      message.success(`已按现有设计孔深回填 ${count} 个孔的设计资料（层位取 0~设计孔深全段）`);
    } else {
      message.info('台帐中的孔都已有设计资料');
    }
  };

  const columns: TableColumnsType<HoleDesign> = [
    { title: '孔号', dataIndex: 'holeNo', width: 110, render: (v: string) => <Text strong>{v}</Text> },
    { title: '设计孔深(m)', dataIndex: 'designDepth', width: 110, align: 'right' },
    {
      title: '设计见矿层位(m)',
      width: 150,
      render: (_, row) => (
        <Text>
          {row.oreFrom}~{row.oreTo}
        </Text>
      ),
    },
    {
      title: '层位厚度(m)',
      width: 110,
      align: 'right',
      render: (_, row) => Number((row.oreTo - row.oreFrom).toFixed(2)),
    },
    {
      title: '台帐对应',
      width: 110,
      render: (_, row) =>
        ledgerHoleNos.has(row.holeNo) ? <Tag color="green">台帐在册</Tag> : <Tag color="orange">台帐无此孔</Tag>,
    },
    {
      title: '最近修改',
      width: 150,
      render: (_, row) => dayjs(row.updatedAt).format('YYYY-MM-DD HH:mm'),
    },
    { title: '备注', dataIndex: 'remark', ellipsis: true },
    {
      title: '操作',
      width: 130,
      fixed: 'right',
      render: (_, record) => (
        <Space size={2}>
          <Button size="small" type="link" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title={`确认删除 ${record.holeNo} 的设计资料？`}
            description="只删设计组这份，不动钻探台帐"
            onConfirm={async () => {
              await removeDesign(record.id);
              message.success(`已删除 ${record.holeNo} 的设计资料`);
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
        设计台账
      </Title>
      <Paragraph type="secondary">
        地质设计组资料：设计孔深与设计见矿层位单独存放，季度对账以本页层位为准比对实测回次。
      </Paragraph>

      <Alert
        style={{ marginBottom: 12 }}
        type="info"
        showIcon
        message="两份资料各管各的：本页改动只写设计台账，不动钻探班组的钻孔台帐与回次记录；反之亦然。"
      />

      <Space style={{ marginBottom: 12 }} wrap>
        <Button type="primary" onClick={openCreate}>
          新建设计
        </Button>
        <Button onClick={handleBackfill} disabled={missingCount === 0}>
          按台帐回填缺失设计{missingCount > 0 ? `（缺 ${missingCount} 孔）` : ''}
        </Button>
      </Space>

      {designs.length === 0 ? (
        <EmptyPanel description="暂无设计资料，可新建设计或按台帐回填" actionText="新建设计" onAction={openCreate} />
      ) : (
        <Card size="small">
          <Table rowKey="id" size="small" columns={columns} dataSource={designs} pagination={{ pageSize: 8 }} scroll={{ x: 1100 }} />
        </Card>
      )}

      <Modal
        open={open}
        title={editing ? `编辑设计 · ${editing.holeNo}` : '新建设计'}
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText="保存"
        cancelText="取消"
        width={560}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="holeNo" label="孔号" rules={[{ required: true, message: '请输入孔号' }]}>
            <AutoComplete
              placeholder="如：ZK-2406（可选取台帐已有孔号）"
              options={holes.map((h) => ({ value: h.holeNo }))}
              filterOption={(input, option) => (option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
              disabled={Boolean(editing)}
            />
          </Form.Item>
          <Form.Item name="designDepth" label="设计孔深(m)" rules={[{ required: true, message: '请输入设计孔深' }]}>
            <InputNumber min={0} style={{ width: 200 }} placeholder="设计孔深" />
          </Form.Item>
          <Space size={12} align="start">
            <Form.Item name="oreFrom" label="见矿层位起深度(m)" rules={[{ required: true, message: '请输入起深度' }]}>
              <InputNumber min={0} style={{ width: 200 }} placeholder="如：120" />
            </Form.Item>
            <Form.Item
              name="oreTo"
              label="见矿层位止深度(m)"
              dependencies={['oreFrom', 'designDepth']}
              rules={[
                { required: true, message: '请输入止深度' },
                ({ getFieldValue }) => ({
                  validator: (_, value) => {
                    if (value === undefined || value === null) return Promise.resolve();
                    if (value <= (getFieldValue('oreFrom') ?? 0)) return Promise.reject(new Error('止深度必须大于起深度'));
                    if (value > (getFieldValue('designDepth') ?? 0)) return Promise.reject(new Error('见矿层位不能超出设计孔深'));
                    return Promise.resolve();
                  },
                }),
              ]}
            >
              <InputNumber min={0} style={{ width: 200 }} placeholder="如：160" />
            </Form.Item>
          </Space>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={80} placeholder="矿体特征、层位依据等" />
          </Form.Item>
        </Form>
        <Alert type="info" showIcon message="旧数据回填规则：没有设计见矿层位的孔，按现有设计孔深取 0~设计孔深全段生成。" />
      </Modal>
    </div>
  );
}
