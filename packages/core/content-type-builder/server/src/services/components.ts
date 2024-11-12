import type { Internal, Struct } from '@strapi/types';
import { get, has } from 'lodash';

import { formatAttributes, replaceTemporaryUIDs } from '../utils/attributes';
import createBuilder from './schema-builder';

/**
 * Formats a component attributes
 */
export const formatComponent = (component: any) => {
  const { uid, modelName, connection, collectionName, info, category } = component;

  return {
    uid,
    category,
    apiId: modelName,
    schema: {
      displayName: get(info, 'displayName'),
      description: get(info, 'description', ''),
      icon: get(info, 'icon'),
      connection,
      collectionName,
      pluginOptions: component.pluginOptions,
      attributes: formatAttributes(component),
    },
  };
};

/**
 * Creates a component and handle the nested components sent with it
 */
export const createComponent = async ({ component, components = [] }: any) => {
  const builder = createBuilder();

  const uidMap = builder.createNewComponentUIDMap(components);
  const replaceTmpUIDs = replaceTemporaryUIDs(uidMap);

  const newComponent = builder.createComponent(replaceTmpUIDs(component));

  components.forEach((component: any) => {
    if (!has(component, 'uid')) {
      return builder.createComponent(replaceTmpUIDs(component));
    }

    return builder.editComponent(replaceTmpUIDs(component));
  });

  await builder.writeFiles();

  strapi.eventHub.emit('component.create', { component: newComponent });

  return newComponent;
};

type ComponentToCreate = {
  component: Struct.ComponentSchema;
  components?: Struct.ComponentSchema[];
};

export const editComponent = async (
  uid: Internal.UID.Component,
  { component, components = [] }: ComponentToCreate
) => {
  const builder = createBuilder();

  const uidMap = builder.createNewComponentUIDMap(components);
  const replaceTmpUIDs = replaceTemporaryUIDs(uidMap);

  const updatedComponent = builder.editComponent({
    uid,
    ...replaceTmpUIDs(component),
  });

  components.forEach((component) => {
    if (!has(component, 'uid')) {
      return builder.createComponent(replaceTmpUIDs(component));
    }

    return builder.editComponent(replaceTmpUIDs(component));
  });

  await builder.writeFiles();

  strapi.eventHub.emit('component.update', { component: updatedComponent });

  return updatedComponent;
};

export const deleteComponent = async (deleteUid: Internal.UID.Component) => {
  const failedDeletes: any[] = [];

  const deletedComponent = await strapi.db.transaction(async ({ trx }) => {
    const builder = createBuilder();

    const models = [...builder.contentTypes.entries(), ...builder.components.entries()];

    // Find models that include an attribute with this component as a target and delete references to it from the db
    for (const [modelUid] of models) {
      const metadata = strapi.db.metadata.get(modelUid);

      const matchingAttributes = Object.values(metadata.attributes).filter(
        (attr: any) => attr.target === deleteUid && attr.joinTable?.name
      );

      // Delete entries in each join table associated with matching attributes
      for (const attr of matchingAttributes) {
        if (!('joinTable' in attr && attr.joinTable && attr.joinTable.name)) {
          continue;
        }

        // Deleting component data is not critical
        try {
          await trx.delete().from(attr.joinTable.name).where('component_type', deleteUid);
        } catch (error) {
          failedDeletes.push({ table: attr.joinTable.name, error });
        }
      }
    }

    // Remove the component from schemas and write changes
    const component = builder.deleteComponent(deleteUid);
    await builder.writeFiles();

    return component;
  });

  if (failedDeletes.length > 0) {
    strapi.log.warn(
      `Failed to delete component data for ${deleteUid} from ${failedDeletes.map((attr) => attr.table)}`
    );
  }

  // Emit delete event after transaction completes
  strapi.eventHub.emit('component.delete', { component: deletedComponent });

  return deletedComponent;
};
