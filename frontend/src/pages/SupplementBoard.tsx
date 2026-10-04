import { useMemo } from 'react';
import { Alert, App as AntApp, Button, Card, Col, Popconfirm, Row, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import StatBadge from '../components/common/StatBadge';
import EmptyPanel from '../components/common/EmptyPanel';
import { useHoleStore } from '../stores/holeStore';
import { useRunStore } from '../stores/runStore';
import {
  useSupplementStore,
  issuedOrders,
  queuedOrders,
  doneOrders,
} from '../stores/supplementStore';
import type { SupplementOrder } from '../types/supplement';
import { SUPPLEMENT_CAPACITY } from '../utils/reconcile';

const { Title, Paragraph, Text } = Typography;

const fmt = (iso?: string) => (iso ? dayjs(iso).format('YYYY-MM-DD HH:mm') : '-');

const gapsText = (gaps: Array<{ from: number; to: number }>) =>
  gaps.length ? gaps.map((g) => `${g.from}~${g.to}m`).join('、') : '-';

/** 补勘调度：季度对账下发补勘，容量有限排队顺延，空位按序放 */
export default function SupplementBoard() {
  const { message } = AntApp.useApp();
  const holes = useHoleStore((s) => s.holes);
  const runs = useRunStore((s) => s.runs);
  const orders = useSupplementStore((s) => s.orders);
  const reconcile = useSupplementStore((s) => s.reconcile);
  const markDone = useSupplementStore((s) => s.markDone);
  const cancelOrder = useSupplementStore((s) => s.cancelOrder);

  const issued = useMemo(() => issuedOrders(orders), [orders]);
  const queued = useMemo(() => queuedOrders(orders), [orders]);
  const done = useMemo(() => doneOrders(orders), [orders]);

  const handleReconcile = async () => {
    const result = await reconcile(holes, runs);
    message.success(
      `对账完成：覆盖 ${result.covered} 孔，下发 ${result.issued} 单，排队 ${result.queued} 单，照旧跳过 ${result.skipped} 孔`,
    );
  };

  const columns: TableColumnsType<SupplementOrder> = [
    { title: '孔号', dataIndex: 'holeNo', width: 110, render: (v: string) => <Text strong>{v}</Text> },
    {
      title: '设计见矿层位(m)',
      width: 140,
      render: (_, row) => `${row.designOreFrom}~${row.designOreTo}`,
    },
    { title: '实测断档区间', render: (_, row) => <span style={{ fontSize: 12 }}>{gapsText(row.gaps)}</span> },
    { title: '批次', dataIndex: 'batchNo', width: 180, render: (v: string) => <Text code>{v}</Text> },
    { title: '建单时间', width: 150, render: (_, row) => fmt(row.createdAt) },
    {
      title: '状态',
      width: 110,
      render: (_, row) =>
        row.status === 'issued' ? (
          <Tag color="blue">已下发</Tag>
        ) : row.status === 'queued' ? (
          <Tag color="orange">排队顺延</Tag>
        ) : row.status === 'done' ? (
          <Tag color="green">已完成</Tag>
        ) : (
          <Tag>已取消</Tag>
        ),
    },
    {
      title: '操作',
      width: 160,
      render: (_, row) => (
        <Space size={2}>
          {row.status === 'issued' ? (
            <Popconfirm title={`确认 ${row.holeNo} 补勘完成？完成后释放钻机容量`} onConfirm={() => markDone(row.id)}>
              <Button size="small" type="link">
                完成
              </Button>
            </Popconfirm>
          ) : null}
          {row.status === 'queued' || row.status === 'issued' ? (
            <Popconfirm title={`确认取消 ${row.holeNo} 的补勘订单？`} onConfirm={() => cancelOrder(row.id)}>
              <Button size="small" type="link" danger>
                取消
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        补勘调度
      </Title>
      <Paragraph type="secondary">
        季度对账时以「设计见矿层位」比对「实测回次」，覆盖不上（层位内有断档）的孔下发补勘。补勘钻机容量有限，排满的孔排队顺延，已下发的照旧，空位按序放。
      </Paragraph>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatBadge
            label="已下发补勘"
            value={issued.length}
            unit={`/ ${SUPPLEMENT_CAPACITY} 台`}
            status={issued.length >= SUPPLEMENT_CAPACITY ? 'error' : 'default'}
            hint="占用补勘钻机容量"
          />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="排队顺延" value={queued.length} unit="孔" status={queued.length ? 'warning' : 'success'} hint="容量满，按序候补" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="已完成补勘" value={done.length} unit="孔" status="success" hint="释放钻机容量并补满排队" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="补勘钻机容量" value={SUPPLEMENT_CAPACITY} unit="台" status="default" hint="同时下发上限" />
        </Col>
      </Row>

      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" onClick={handleReconcile}>
          发起季度对账
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          对账可中断重试：已比过的孔留着不重复开单，重试时按设计见矿层位重新比对下发。
        </Text>
      </Space>

      {issued.length >= SUPPLEMENT_CAPACITY && queued.length > 0 ? (
        <Alert
          style={{ marginBottom: 12 }}
          type="warning"
          showIcon
          message={`补勘钻机已排满（${issued.length}/${SUPPLEMENT_CAPACITY}），${queued.length} 孔排队顺延；已有空位时将按排队顺序自动下发。`}
        />
      ) : null}

      <Card title={`已下发补勘（${issued.length}）`} size="small" style={{ marginBottom: 16 }}>
        <Table
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={issued}
          pagination={{ pageSize: 6, hideOnSinglePage: true }}
          locale={{ emptyText: '暂无已下发补勘；点击「发起季度对账」按设计见矿层位比对下发' }}
        />
      </Card>

      <Card title={`排队顺延（${queued.length}）`} size="small" style={{ marginBottom: 16 }}>
        <Table
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={queued}
          pagination={{ pageSize: 6, hideOnSinglePage: true }}
          locale={{ emptyText: '暂无排队孔位' }}
        />
      </Card>

      <Card title={`已完成（${done.length}）`} size="small">
        <Table
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={done}
          pagination={{ pageSize: 6, hideOnSinglePage: true }}
          locale={{ emptyText: '暂无已完成补勘' }}
        />
      </Card>

      {orders.length === 0 ? <EmptyPanel description="还没有补勘订单" actionText="发起季度对账" onAction={handleReconcile} /> : null}
    </div>
  );
}
