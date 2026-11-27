'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { filterRackSearchItems } from '@/components/layout/global-search';
import { useAuth } from '@/lib/auth';
import { disconnectPduDevice, deleteRack as apiDeleteRack, placeDevice as apiPlaceDevice, previewDevicePlacement, reorderRacks as apiReorderRacks } from '../api';
import { RackWorkspace } from '../components/rack/rack-workspace';
import { withoutPduConnection } from '../power';
import type { Rack, RackEditDraft, RackPlacementPlan, RoomWithBuilding } from '../types';
import { useInfrastructureWorkspace } from '../workspace-context';

type RacksTabProps = {
  rooms: RoomWithBuilding[];
  buildingId: string;
  roomId: string;
  rackId: string;
  setRoomId: (id: string) => void;
  setRackId: (id: string) => void;
  /** Opens the rack form (new rack when the draft has no id). */
  onEditRack: (rack: RackEditDraft) => void;
};

/** Bastidores: the racks of the selected Room, with placement, reordering, rack deletion and PDU disconnects. */
export function RacksTab({ rooms, buildingId, roomId, rackId, setRoomId, setRackId, onEditRack }: RacksTabProps) {
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  const { siteId, racks, navigation, access, snmpHealth, openDevice, editDevice, setError, invalidateInfrastructure, askConfirm, offerPowerStep } = useInfrastructureWorkspace();
  const [deletingRackId, setDeletingRackId] = useState('');

  const selectedRack = racks.find((item) => item.id === rackId);
  const allRoomRacks = racks.filter((item) => (item.room?.id ?? item.roomId) === roomId);
  const roomRacks = filterRackSearchItems(allRoomRacks, navigation.search);
  const canReorderRacks = (hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR')) && Boolean(roomId) && access.scopeActions.includes('UPDATE');
  const canDeleteRack = hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR');

  /** "Desligar" from a PDU card: the badge drops at once, then the API answer (or a refetch on error) settles it. */
  const disconnectPdu = async (targetRackId: string, pduId: string, deviceId: string) => {
    const racksKey = ['infrastructure', 'racks', siteId];
    await queryClient.cancelQueries({ queryKey: racksKey });
    queryClient.setQueryData<Rack[]>(racksKey, (current) => current?.map((rack) => (rack.id === targetRackId ? withoutPduConnection(rack, pduId, deviceId) : rack)));
    try {
      await disconnectPduDevice(targetRackId, pduId, deviceId);
    } finally {
      await invalidateInfrastructure();
    }
  };
  const previewPlacement = async (deviceId: string, targetRackId: string, rackUnitStart: number): Promise<RackPlacementPlan> => {
    try {
      setError('');
      return await previewDevicePlacement(deviceId, { rackId: targetRackId, rackUnitStart });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Não foi possível pré-visualizar a posição do equipamento.';
      setError(message);
      throw cause;
    }
  };
  const placeDevice = async (deviceId: string, targetRackId: string, rackUnitStart: number) => {
    try {
      setError('');
      const placed = racks.flatMap((rack) => rack.devices ?? []).find((item) => item.id === deviceId);
      const result = await apiPlaceDevice(deviceId, { rackId: targetRackId, rackUnitStart });
      await invalidateInfrastructure();
      // Moved to another rack: its outlets were released, so offer the power step for the new rack.
      if (placed && placed.rackId !== targetRackId) void offerPowerStep({ ...placed, rackId: targetRackId }, placed.rackId ?? '');
      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Não foi possível atualizar a localização do equipamento.';
      setError(message);
      throw cause;
    }
  };
  const reorderRacks = async (targetRoomId: string, rackIds: string[]) => {
    try {
      setError('');
      await apiReorderRacks(targetRoomId, rackIds);
      await invalidateInfrastructure();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Não foi possível guardar a ordem dos bastidores.';
      setError(message);
      throw cause;
    }
  };
  const deleteRack = async (rack: Rack) => {
    if (!(await askConfirm({ message: `Eliminar o bastidor “${rack.name}”? Os bastidores seguintes serão deslocados uma posição para a esquerda.`, destructive: true }))) return;
    setDeletingRackId(rack.id);
    setError('');
    try {
      await apiDeleteRack(rack.id);
      setRackId('');
      const url = new URL(location.href);
      url.searchParams.delete('rackId');
      history.replaceState({}, '', `${url.pathname}${url.search}`);
      await invalidateInfrastructure();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível eliminar o bastidor.');
    } finally {
      setDeletingRackId('');
    }
  };
  const setRack = (rack: Rack) => {
    if (rack.room) setRoomId(rack.room.id);
    setRackId(rack.id);
    history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&buildingId=${rack.room?.building?.id ?? buildingId}&roomId=${rack.room?.id ?? roomId}&rackId=${rack.id}`);
  };

  return <RackWorkspace rooms={rooms} roomId={roomId} buildingId={buildingId} racks={roomRacks} allRoomRacks={allRoomRacks} selected={selectedRack} setRack={setRack} onOut={() => setRackId('')} onDevice={openDevice} onEdit={onEditRack} onDelete={canDeleteRack && access.scopeActions.includes('DELETE') ? deleteRack : undefined} deletingRackId={deletingRackId} canEdit={access.canEdit} onPreviewPlacement={previewPlacement} onPlaceDevice={placeDevice} onReorderRacks={reorderRacks} canReorderRacks={canReorderRacks} onEditDevice={editDevice} canEditPower={access.canEditPower} onDisconnectPdu={disconnectPdu} health={snmpHealth} />;
}
