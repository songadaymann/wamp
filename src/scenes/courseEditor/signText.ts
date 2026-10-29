import { getObjectById, type PlacedObject } from '../../config';
import { requestSignTextEdit } from '../../signs/events';
import { getPlacedObjectSignText } from '../../signs/model';
export function openPlacedSignTextEditor(placed:PlacedObject,sliceLabel:string):void {
  if(!placed.instanceId)return;
  requestSignTextEdit({instanceId:placed.instanceId,objectId:placed.id,
    objectLabel:getObjectById(placed.id)?.name??'Sign',currentText:getPlacedObjectSignText(placed)??'',contextHint:sliceLabel});
}
